"""Persist and apply runtime LLM settings (base URL, API key, default model).

Never log the raw API key.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from urllib.parse import urlparse

from .auth import require_token
from .config import STABLE_MODEL, settings

router = APIRouter(dependencies=[Depends(require_token)])


class RuntimeConfigIn(BaseModel):
    base_url: str | None = Field(default=None)
    api_key: str | None = Field(default=None)
    default_model: str | None = Field(default=None)


def _path() -> Path:
    p = Path(settings.data_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p / "runtime.json"


def load() -> dict[str, Any]:
    path = _path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def apply_and_save(patch: dict[str, Any]) -> dict[str, Any]:
    if "default_model" in patch and patch["default_model"]:
        requested_model = str(patch["default_model"]).strip()
        if requested_model != STABLE_MODEL:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported model; Grox v1.0 only supports {STABLE_MODEL}",
            )
    data = load()
    base_url_changed = False
    if "base_url" in patch and patch["base_url"]:
        candidate = str(patch["base_url"]).strip().rstrip("/")
        parsed = urlparse(candidate)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="base_url must be an absolute http(s) URL",
            )
        if parsed.username or parsed.password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="base_url must not contain credentials",
            )
        data["base_url"] = candidate
        settings.anthropic_base_url = data["base_url"]
        settings.chat_model_router_url = data["base_url"]
        base_url_changed = True
    if "api_key" in patch and patch["api_key"] is not None:
        data["api_key"] = str(patch["api_key"])
        settings.anthropic_api_key = data["api_key"]
    data["default_model"] = STABLE_MODEL
    settings.chat_default_model = STABLE_MODEL
    path = _path()
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)
    if base_url_changed:
        try:
            from .models_api import clear_models_cache
        except ImportError:
            clear_models_cache = None  # type: ignore[assignment]
        if clear_models_cache is not None:
            clear_models_cache()
    return public_view()


def public_view() -> dict[str, Any]:
    data = load()
    key = data.get("api_key") or settings.anthropic_api_key
    return {
        "base_url": data.get("base_url") or settings.anthropic_base_url,
        "api_key_set": bool(key),
        "default_model": STABLE_MODEL,
    }


def bootstrap_from_disk() -> None:
    data = load()
    if data.get("base_url"):
        settings.anthropic_base_url = data["base_url"]
        settings.chat_model_router_url = data["base_url"]
    if data.get("api_key"):
        settings.anthropic_api_key = data["api_key"]
    settings.chat_default_model = STABLE_MODEL


@router.get("/api/runtime-config")
def get_runtime_config() -> dict[str, Any]:
    return public_view()


@router.put("/api/runtime-config")
def put_runtime_config(body: RuntimeConfigIn) -> dict[str, Any]:
    patch = body.model_dump(exclude_unset=True)
    return apply_and_save(patch)
