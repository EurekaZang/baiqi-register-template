from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_dry_run_smoke() -> None:
    out = ROOT / "tmp" / "smoke-output"
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "run.py"),
            "--channel",
            "example",
            "--config",
            str(ROOT / "config.example.json"),
            "--count",
            "2",
            "--output-dir",
            str(out),
        ],
        check=True,
        cwd=ROOT,
    )
    records = json.loads((out / "results.json").read_text(encoding="utf-8"))
    assert len(records) == 2
    assert all(record["ok"] for record in records)
    assert (out / "accounts_for_import.jsonl").read_text(encoding="utf-8").count("\n") == 2
    assert (out / "run.log").exists()


def test_fake_protocol_smoke() -> None:
    out = ROOT / "tmp" / "fake-protocol-output"
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "run.py"),
            "--channel",
            "fake_protocol",
            "--config",
            str(ROOT / "config.example.json"),
            "--count",
            "1",
            "--output-dir",
            str(out),
        ],
        check=True,
        cwd=ROOT,
    )
    records = json.loads((out / "results.json").read_text(encoding="utf-8"))
    assert records[0]["ok"] is True
    assert records[0]["artifacts"]["api_key"].startswith("sk-fake-")
    line = (out / "accounts_for_import.jsonl").read_text(encoding="utf-8")
    assert "access_token" in line
    log = (out / "run.log").read_text(encoding="utf-8")
    assert "start signup: ok" in log


if __name__ == "__main__":
    test_dry_run_smoke()
    test_fake_protocol_smoke()
