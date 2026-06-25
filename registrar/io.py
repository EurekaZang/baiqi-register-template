from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"json root must be object: {path}")
    return data


def write_outputs(output_dir: Path, records: list[dict[str, Any]]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "results.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [json.dumps(flatten_account(record), ensure_ascii=False) for record in records if record.get("ok")]
    (output_dir / "accounts_for_import.jsonl").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def flatten_account(record: dict[str, Any]) -> dict[str, Any]:
    artifacts = record.get("artifacts") or {}
    account = record.get("account") or {}
    return {
        "email": record.get("email", ""),
        "password": record.get("password", ""),
        "user_id": account.get("user_id", ""),
        "api_key": artifacts.get("api_key", ""),
        "access_token": artifacts.get("access_token", ""),
        "refresh_token": artifacts.get("refresh_token", ""),
        "cookies": artifacts.get("cookies", ""),
        "status": record.get("status", ""),
        "reason": record.get("reason", ""),
    }
