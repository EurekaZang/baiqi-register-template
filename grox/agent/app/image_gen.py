"""Composer Image mode — generate images via grok2api lite and serve locally."""

from __future__ import annotations

import base64
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .auth import require_token
from .config import settings
from .sessions import get_session, save_session

router = APIRouter(dependencies=[Depends(require_token)])

PROMPT_MAX_LEN = 2000
_FILE_ID_RE = re.compile(r"^[0-9a-fA-F-]{8,64}\.(?:jpg|jpeg|png|webp)$")


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


def _public_image_url(session_id: str, file_id: str) -> str:
    """URL the browser can load via the dashboard /chat proxy."""
    root = (settings.chat_root_path or "/chat").rstrip("/") or "/chat"
    return f"{root}/api/sessions/{session_id}/generated/{file_id}"


def _session_image_dir(session_id: str) -> Path:
    base = Path(settings.chat_generated_images_dir)
    base.mkdir(parents=True, exist_ok=True)
    path = base / session_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _sniff_ext(raw: bytes) -> str:
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return "jpg"


def _save_image_bytes(session_id: str, raw: bytes) -> str:
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Image backend returned empty image data",
        )
    ext = _sniff_ext(raw)
    file_id = f"{uuid.uuid4().hex}.{ext}"
    path = _session_image_dir(session_id) / file_id
    path.write_bytes(raw)
    return file_id


class ImageGenRequest(BaseModel):
    prompt: str = Field(default="")
    n: int | None = None


async def _call_grok2api_images(prompt: str, n: int) -> list[bytes]:
    """Return raw image bytes for each generated image (prefer b64_json)."""
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
        "response_format": "b64_json",
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
                    detail = (
                        str(err)
                        if not isinstance(err, dict)
                        else str(err.get("message") or err)
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

    blobs: list[bytes] = []
    remote_urls: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        b64 = item.get("b64_json")
        if isinstance(b64, str) and b64.strip():
            try:
                blobs.append(base64.b64decode(b64, validate=False))
                continue
            except Exception:
                pass
        u = item.get("url")
        if isinstance(u, str) and u.strip():
            remote_urls.append(u.strip())

    # Fallback: download remote URLs server-side if b64 missing
    if not blobs and remote_urls:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                for u in remote_urls:
                    r = await client.get(u)
                    if r.status_code < 400 and r.content:
                        blobs.append(r.content)
        except httpx.HTTPError:
            pass

    if not blobs:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="upstream returned no image data",
        )
    return blobs


def _append_messages(
    session: dict[str, Any],
    *,
    prompt: str,
    local_urls: list[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    now = _now_iso()
    user_msg: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "role": "user",
        "content": prompt,
        "created_at": now,
        "meta": {"kind": "image_prompt"},
    }
    md = "\n\n".join(f"![image]({u})" for u in local_urls)
    assistant_msg: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "role": "assistant",
        "content": md,
        "created_at": _now_iso(),
        "meta": {
            "kind": "image",
            "model": settings.chat_image_model,
            "urls": local_urls,
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
    blobs = await _call_grok2api_images(prompt, n)
    local_urls: list[str] = []
    for raw in blobs:
        file_id = _save_image_bytes(session_id, raw)
        local_urls.append(_public_image_url(session_id, file_id))

    user_msg, assistant_msg = _append_messages(
        session, prompt=prompt, local_urls=local_urls
    )

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


@router.get("/api/sessions/{session_id}/generated/{file_id}")
def api_get_generated_image(session_id: str, file_id: str) -> FileResponse:
    """Serve a previously generated image (auth required; CDN is not public)."""
    # Validate session exists (also 404s unknown ids)
    get_session(session_id)
    if not _FILE_ID_RE.match(file_id or ""):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid file id",
        )
    # Prevent path escape
    if "/" in file_id or "\\" in file_id or ".." in file_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid file id",
        )
    path = Path(settings.chat_generated_images_dir) / session_id / file_id
    try:
        path = path.resolve(strict=True)
        root = Path(settings.chat_generated_images_dir).resolve()
        path.relative_to(root)
    except (FileNotFoundError, OSError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="image not found",
        ) from None
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="image not found",
        )
    media = "image/jpeg"
    lower = file_id.lower()
    if lower.endswith(".png"):
        media = "image/png"
    elif lower.endswith(".webp"):
        media = "image/webp"
    return FileResponse(
        path,
        media_type=media,
        filename=file_id,
        headers={"Cache-Control": "private, max-age=86400"},
    )
