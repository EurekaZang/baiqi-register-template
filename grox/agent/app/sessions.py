from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .auth import require_token
from .config import STABLE_MODEL, settings

router = APIRouter(dependencies=[Depends(require_token)])

RECENT_CWD_FILENAME = "recent_cwds.json"
RECENT_CWD_LIMIT = 20


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_sessions_dir() -> Path:
    path = Path(settings.sessions_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _session_path(session_id: str) -> Path:
    try:
        canonical = str(uuid.UUID(str(session_id)))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        ) from None
    return _ensure_sessions_dir() / f"{canonical}.json"


def _recent_path() -> Path:
    return _ensure_sessions_dir() / RECENT_CWD_FILENAME


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def normalize_cwd_input(cwd: str) -> str:
    """Expand ~ and tidy slashes/spaces for user-entered paths."""
    text = (cwd or "").strip()
    if not text:
        return text
    # Expand ~/... and bare ~
    if text == "~" or text.startswith("~/") or text.startswith("~\\"):
        text = str(Path(text).expanduser())
    # Collapse accidental whitespace around separators
    text = text.replace("\\", "/")
    # Preserve the leading double slash of a Windows UNC path.
    unc = text.startswith("//")
    remainder = text[2:] if unc else text
    while "//" in remainder:
        remainder = remainder.replace("//", "/")
    text = f"//{remainder}" if unc else remainder
    # Keep POSIX root "/" and Windows drive roots such as "D:/" intact.
    # Stripping the slash from "D:/" produces drive-relative "D:", which
    # pathlib correctly rejects as non-absolute on Windows.
    is_windows_drive_root = (
        len(text) == 3
        and text[0].isalpha()
        and text[1:] == ":/"
    )
    if len(text) > 1 and not is_windows_drive_root:
        text = text.rstrip("/")
    return text


def validate_cwd(cwd: str) -> Path:
    if not cwd or not isinstance(cwd, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="cwd must be an absolute existing directory",
        )
    normalized = normalize_cwd_input(cwd)
    path = Path(normalized)
    if not path.is_absolute():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="cwd must be an absolute existing directory (tip: use /home/... or ~/...)",
        )
    try:
        resolved = path.resolve(strict=True)
    except (FileNotFoundError, OSError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"cwd does not exist: {normalized}",
        ) from None
    if not resolved.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"cwd is not a directory: {normalized}",
        )
    return resolved


def load_recent_cwds() -> list[str]:
    path = _recent_path()
    if not path.is_file():
        return []
    try:
        data = _read_json(path)
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    # Normalize + drop missing dirs so the picker never offers dead paths
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in data:
        if not isinstance(item, str):
            continue
        try:
            resolved = str(validate_cwd(item))
        except HTTPException:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        cleaned.append(resolved)
    if cleaned != [i for i in data if isinstance(i, str)][: len(cleaned)]:
        # Persist cleanup best-effort
        try:
            save_recent_cwds(cleaned)
        except OSError:
            pass
    return cleaned


def save_recent_cwds(items: list[str]) -> None:
    _write_json(_recent_path(), items[:RECENT_CWD_LIMIT])


def touch_recent_cwd(cwd: str) -> list[str]:
    try:
        resolved = str(validate_cwd(cwd))
    except HTTPException:
        resolved = normalize_cwd_input(cwd)
    items = [c for c in load_recent_cwds() if c != resolved]
    items.insert(0, resolved)
    items = items[:RECENT_CWD_LIMIT]
    save_recent_cwds(items)
    return items


def save_session(session: dict[str, Any]) -> dict[str, Any]:
    session_id = session["id"]
    _write_json(_session_path(session_id), session)
    return session


def get_session(session_id: str) -> dict[str, Any]:
    path = _session_path(session_id)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )
    try:
        data = _read_json(path)
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read session",
        ) from exc
    canonical_id = path.stem
    if not isinstance(data, dict) or data.get("id") != canonical_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Corrupt session file",
        )
    if data.get("model") != STABLE_MODEL:
        data["model"] = STABLE_MODEL
        data["sdk_session_id"] = None
        try:
            save_session(data)
        except OSError:
            pass
    return data


def list_sessions() -> list[dict[str, Any]]:
    directory = _ensure_sessions_dir()
    sessions: list[dict[str, Any]] = []
    for path in directory.glob("*.json"):
        if path.name == RECENT_CWD_FILENAME:
            continue
        try:
            data = _read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and "id" in data:
            if data.get("model") != STABLE_MODEL:
                data["model"] = STABLE_MODEL
                data["sdk_session_id"] = None
                try:
                    save_session(data)
                except (OSError, HTTPException):
                    pass
            sessions.append(data)
    sessions.sort(key=lambda s: s.get("updated_at") or s.get("created_at") or "", reverse=True)
    return sessions


def create_session(*, cwd: str, title: str | None = None, model: str | None = None) -> dict[str, Any]:
    resolved = validate_cwd(cwd)
    requested_model = (model or STABLE_MODEL).strip()
    if requested_model != STABLE_MODEL:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported model; Grox v1.0 only supports {STABLE_MODEL}",
        )
    now = _now_iso()
    session = {
        "id": str(uuid.uuid4()),
        "title": title or "New chat",
        "cwd": str(resolved),
        "model": STABLE_MODEL,
        "sdk_session_id": None,
        "created_at": now,
        "updated_at": now,
        "status": "idle",
        "pinned": False,
        "messages": [],
        "context_usage": None,
        "last_usage": None,
    }
    save_session(session)
    touch_recent_cwd(session["cwd"])
    return session


def delete_session(session_id: str) -> None:
    session = get_session(session_id)
    if session.get("status") == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a running session; stop it first",
        )
    path = _session_path(session_id)
    try:
        path.unlink()
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete session",
        ) from exc


def update_session(
    session_id: str,
    *,
    title: str | None = None,
    cwd: str | None = None,
    model: str | None = None,
    pinned: bool | None = None,
) -> dict[str, Any]:
    session = get_session(session_id)
    if session.get("status") == "running" and (cwd is not None or model is not None):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot change cwd or model while session is running",
        )

    changed = False
    if title is not None:
        session["title"] = title
        changed = True
    if cwd is not None:
        resolved = validate_cwd(cwd)
        next_cwd = str(resolved)
        if next_cwd != session.get("cwd"):
            session["sdk_session_id"] = None
        session["cwd"] = next_cwd
        touch_recent_cwd(session["cwd"])
        changed = True
    if model is not None:
        next_model = (model or "").strip() or STABLE_MODEL
        if next_model != STABLE_MODEL:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported model; Grox v1.0 only supports {STABLE_MODEL}",
            )
        if session.get("model") != STABLE_MODEL:
            session["model"] = STABLE_MODEL
            session["sdk_session_id"] = None
            changed = True
    if pinned is not None:
        session["pinned"] = bool(pinned)
        changed = True
    elif "pinned" not in session:
        session["pinned"] = False

    if changed:
        session["updated_at"] = _now_iso()
        save_session(session)
    return session


class CreateSessionRequest(BaseModel):
    cwd: str
    title: str | None = None
    model: str | None = None


class PatchSessionRequest(BaseModel):
    title: str | None = None
    cwd: str | None = None
    model: str | None = None
    pinned: bool | None = None


@router.get("/api/sessions")
def api_list_sessions() -> list[dict[str, Any]]:
    sessions = list_sessions()
    # Normalize legacy sessions missing pinned; sort pinned first then updated_at.
    for s in sessions:
        if "pinned" not in s:
            s["pinned"] = False
    sessions.sort(
        key=lambda s: (
            0 if s.get("pinned") else 1,
            -(
                _sort_ts(s.get("updated_at") or s.get("created_at") or "")
            ),
        )
    )
    return sessions


def _sort_ts(raw: str) -> float:
    try:
        # Accept ISO timestamps; fallback 0.
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


@router.post("/api/sessions")
def api_create_session(payload: CreateSessionRequest) -> dict[str, Any]:
    return create_session(cwd=payload.cwd, title=payload.title, model=payload.model)


@router.get("/api/sessions/{session_id}")
def api_get_session(session_id: str) -> dict[str, Any]:
    session = get_session(session_id)
    if "pinned" not in session:
        session["pinned"] = False
    return session


@router.patch("/api/sessions/{session_id}")
def api_patch_session(session_id: str, payload: PatchSessionRequest) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        return api_get_session(session_id)
    return update_session(
        session_id,
        title=data.get("title"),
        cwd=data.get("cwd"),
        model=data.get("model"),
        pinned=data.get("pinned"),
    )


@router.delete("/api/sessions/{session_id}")
def api_delete_session(session_id: str) -> dict[str, bool]:
    delete_session(session_id)
    return {"ok": True}


@router.get("/api/cwd/recent")
def api_recent_cwds() -> list[str]:
    return load_recent_cwds()
