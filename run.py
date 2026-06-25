from __future__ import annotations

import argparse
import importlib
import logging
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from registrar.context import Context
from registrar.io import load_json, write_outputs
from registrar.result import Result
from registrar.services import build_services


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Universal registrar template")
    parser.add_argument("--channel", default="example", help="directory under channels/")
    parser.add_argument("--config", default="config.example.json")
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--mode", default="", help="override config mode")
    parser.add_argument("--output-dir", default="")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args()


def load_manifest(channel: str) -> dict[str, Any]:
    module = importlib.import_module(f"channels.{channel}.manifest")
    manifest = getattr(module, "MANIFEST")
    if not isinstance(manifest, dict):
        raise ValueError("MANIFEST must be dict")
    return manifest


def import_flow(path: str) -> Callable[[Context], Result]:
    module_name, _, attr = path.partition(":")
    if not module_name or not attr:
        raise ValueError(f"invalid flow path: {path}")
    fn = getattr(importlib.import_module(module_name), attr)
    if not callable(fn):
        raise ValueError(f"flow is not callable: {path}")
    return fn


def run_one(task_id: int, channel: str, run_id: str, settings: dict[str, Any], flow: Callable[[Context], Result]) -> Result:
    logger = logging.getLogger("registrar")
    services = build_services(settings, logger)
    ctx = Context(
        channel=channel,
        task_id=task_id,
        run_id=run_id,
        settings=settings,
        email=services["email"],
        captcha=services["captcha"],
        proxy=services["proxy"],
        http=services["http"],
        logger=logger,
    )
    try:
        logger.info("[%s/%s] task start", channel, task_id)
        result = flow(ctx)
        if not isinstance(result, Result):
            return ctx.fail(status="invalid_result", reason="flow must return registrar.Result")
        logger.info("[%s/%s] task done ok=%s status=%s reason=%s", channel, task_id, result.ok, result.status, result.reason)
        return result
    except Exception as exc:
        logger.exception("[%s/%s] task exception", channel, task_id)
        return ctx.fail(status="exception", reason=str(exc), debug={"exception_type": type(exc).__name__})


def main() -> int:
    args = parse_args()
    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(message)s")
    manifest = load_manifest(args.channel)
    settings = dict(manifest.get("defaults") or {})
    settings.update(load_json(Path(args.config)))
    settings["channel"] = args.channel
    if args.mode:
        settings["mode"] = args.mode

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = Path(args.output_dir) if args.output_dir else ROOT / "output" / args.channel / run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(output_dir / "run.log", encoding="utf-8")
    file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logging.getLogger().addHandler(file_handler)

    flow = import_flow(str(manifest["flow"]))
    workers = max(1, int(args.workers or settings.get("workers") or 1))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda task_id: run_one(task_id, args.channel, run_id, settings, flow), range(1, args.count + 1)))

    records = [result.to_record() for result in results]
    write_outputs(output_dir, records)
    ok = sum(1 for result in results if result.ok)
    logging.info("done ok=%s failed=%s output=%s", ok, len(results) - ok, output_dir)
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
