"""Composer Image mode — generate images via grok2api lite."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .auth import require_token
from .config import settings
from .sessions import get_session, save_session

router = APIRouter(dependencies=[Depends(require_token)])

PROMPT_MAX_LEN = 2000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _title_from_prompt(prompt: str) -> str:
    text = " ".join(prompt.split())
    if len(text) <= 40:
        return text or "Image"
    return text[:40].rstrip() + "…"


def _clamp_n(n: int | None) -> int:
    base = int(n) if n is not None else int(settings.chat_image_n or 1)
    return max(1, min(4, base))


class ImageGenRequest(BaseModel):
    prompt: str = Field(default="")
    n: int | None = None


async def _call_grok2api(prompt: str, n: int) -> list[str]:
    base = settings.chat_grok2api_url.rstrip("/")
    url = f"{base}/v1/images/generations"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    key = (settings.chat_grok2api_api_key or "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"

    payload = {
        "model": settings.chat_image_model,
        "prompt": prompt,
        "n": n,
    }

    timeout = httpx.Timeout(float(settings.chat_image_timeout_sec or 120.0))
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Image backend timed out",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Image backend unreachable: {exc}",
        ) from exc

    if resp.status_code == 429:
        detail = "Image rate limit — try later"
        try:
            body = resp.json()
            if isinstance(body, dict):
                detail = str(body.get("detail") or body.get("error") or detail)
        except Exception:
            pass
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)

    if resp.status_code >= 400:
        detail = f"Image backend error ({resp.status_code})"
        try:
            body = resp.json()
            if isinstance(body, dict):
                err = body.get("detail") or body.get("error") or body.get("message")
                if err:
                    detail = str(err) if not isinstance(err, dict) else str(
                        err.get("message") or err
                    )
        except Exception:
            text = (resp.text or "")[:200]
            if text:
                detail = text
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        )

    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Image backend returned non-JSON",
        ) from exc

    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list) or not items:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Image backend returned no images",
        )

    urls: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        u = item.get("url")
        if isinstance(u, str) and u.strip():
            urls.append(u.strip())

    if not urls:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="upstream returned no url",
        )
    return urls


def _append_messages(
    session: dict[str, Any],
    *,
    prompt: str,
    urls: list[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    now = _now_iso()
    user_msg: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "role": "user",
        "content": prompt,
        "created_at": now,
        "meta": {"kind": "image_prompt"},
    }
    md = "\n\n".join(f"![image]({u})" for u in urls)
    assistant_msg: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "role": "assistant",
        "content": md,
        "created_at": _now_iso(),
        "meta": {
            "kind": "image",
            "model": settings.chat_image_model,
            "urls": urls,
        },
    }
    messages = list(session.get("messages") or [])
    messages.append(user_msg)
    messages.append(assistant_msg)
    session["messages"] = messages
    session["updated_at"] = _now_iso()
    session["status"] = "idle"

    title = (session.get("title") or "").strip() or "New chat"
    if title == "New chat":
        session["title"] = _title_from_prompt(prompt)

    save_session(session)
    return user_msg, assistant_msg


@router.post("/api/sessions/{session_id}/images")
async def api_generate_image(
    session_id: str,
    payload: ImageGenRequest,
) -> dict[str, Any]:
    prompt = (payload.prompt or "").strip()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="prompt is required",
        )
    if len(prompt) > PROMPT_MAX_LEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"prompt too long (max {PROMPT_MAX_LEN})",
        )

    session = get_session(session_id)
    if session.get("status") == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot generate image while session is running",
        )

    n = _clamp_n(payload.n)
    urls = await _call_grok2api(prompt, n)
    user_msg, assistant_msg = _append_messages(session, prompt=prompt, urls=urls)

    # Re-read for fresh session summary fields
    session = get_session(session_id)
    return {
        "user_message": user_msg,
        "assistant_message": assistant_msg,
        "session": {
            "id": session["id"],
            "updated_at": session.get("updated_at"),
            "status": session.get("status"),
            "title": session.get("title"),
        },
    }
