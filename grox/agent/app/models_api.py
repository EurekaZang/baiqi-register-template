from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status

from .auth import require_token
from .config import settings

router = APIRouter(dependencies=[Depends(require_token)])

_cache_payload: dict[str, Any] | None = None
_cache_fetched_at: float | None = None


def clear_models_cache() -> None:
    """Reset in-memory models cache (tests / admin)."""
    global _cache_payload, _cache_fetched_at
    _cache_payload = None
    _cache_fetched_at = None


def _cache_is_fresh() -> bool:
    if _cache_payload is None or _cache_fetched_at is None:
        return False
    ttl = float(settings.models_cache_ttl_sec)
    if ttl <= 0:
        return False
    return (time.monotonic() - _cache_fetched_at) < ttl


def normalize_models_response(raw: Any, *, stale: bool = False) -> dict[str, Any]:
    """Normalize OpenAI-ish /v1/models payload to a stable chat API shape."""
    items: list[Any]
    if isinstance(raw, dict):
        data = raw.get("data", [])
        items = data if isinstance(data, list) else []
    elif isinstance(raw, list):
        items = raw
    else:
        items = []

    normalized: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id")
        if not model_id or not isinstance(model_id, str):
            continue
        display = item.get("display_name")
        if not display or not isinstance(display, str):
            display = model_id
        normalized.append({"id": model_id, "display_name": display})

    return {
        "object": "list",
        "data": normalized,
        "default": settings.chat_default_model,
        "stale": stale,
    }


async def fetch_models_from_router() -> dict[str, Any]:
    url = f"{settings.chat_model_router_url.rstrip('/')}/v1/models"
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


async def get_models_payload() -> tuple[dict[str, Any], bool]:
    """
    Return (normalized_payload, is_stale).

    Fresh cache hits skip the network. On upstream failure, serve last cache
    as stale; if nothing is cached, raise 503.
    """
    global _cache_payload, _cache_fetched_at

    if _cache_is_fresh() and _cache_payload is not None:
        return {**_cache_payload, "stale": False}, False

    try:
        raw = await fetch_models_from_router()
        payload = normalize_models_response(raw, stale=False)
        _cache_payload = payload
        _cache_fetched_at = time.monotonic()
        return payload, False
    except (httpx.HTTPError, ValueError, TypeError):
        if _cache_payload is not None:
            stale_payload = {**_cache_payload, "stale": True}
            return stale_payload, True
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model list unavailable from model router",
        ) from None


@router.get("/api/models")
async def api_list_models(response: Response) -> dict[str, Any]:
    payload, is_stale = await get_models_payload()
    if is_stale:
        response.headers["X-Models-Stale"] = "true"
    else:
        response.headers["X-Models-Stale"] = "false"
    return payload
