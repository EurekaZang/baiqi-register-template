"""Agent task list helpers (TaskCreate / TaskUpdate tool mapping)."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any


TASK_CREATE_TOOLS = {"TaskCreate", "TodoWrite"}
TASK_UPDATE_TOOLS = {"TaskUpdate"}
TASK_TOOLS = TASK_CREATE_TOOLS | TASK_UPDATE_TOOLS

VALID_STATUS = {"pending", "in_progress", "completed", "deleted"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_status(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip().lower()
    if s in VALID_STATUS:
        return s
    return None


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def ensure_tasks_list(session: dict[str, Any]) -> list[dict[str, Any]]:
    tasks = session.get("tasks")
    if not isinstance(tasks, list):
        session["tasks"] = []
        return session["tasks"]
    # Drop non-dicts
    cleaned: list[dict[str, Any]] = []
    for item in tasks:
        if isinstance(item, dict) and item.get("id") is not None:
            cleaned.append(item)
    session["tasks"] = cleaned
    return cleaned


def find_task(tasks: list[dict[str, Any]], task_id: str) -> dict[str, Any] | None:
    tid = str(task_id)
    for t in tasks:
        if str(t.get("id")) == tid:
            return t
    return None


def next_numeric_id(tasks: list[dict[str, Any]]) -> str:
    max_n = 0
    for t in tasks:
        try:
            max_n = max(max_n, int(str(t.get("id"))))
        except (TypeError, ValueError):
            continue
    return str(max_n + 1)


def parse_task_id_from_result(output: Any) -> str | None:
    """Best-effort extract created/updated task id from tool result text/json."""
    if output is None:
        return None
    if isinstance(output, dict):
        for key in ("id", "taskId", "task_id"):
            if key in output and output[key] is not None:
                return str(output[key])
        # nested
        for key in ("task", "data", "result"):
            nested = output.get(key)
            if isinstance(nested, dict):
                found = parse_task_id_from_result(nested)
                if found:
                    return found
        return None
    if isinstance(output, list):
        for item in output:
            found = parse_task_id_from_result(item)
            if found:
                return found
        return None
    text = str(output).strip()
    # JSON string payloads from tool results
    if text.startswith("{") or text.startswith("["):
        try:
            import json

            return parse_task_id_from_result(json.loads(text))
        except Exception:
            pass
    # "id":"1" / "taskId": 2 / id=3
    m = re.search(
        r"(?:task(?:Id)?|id)\s*[\"']?\s*[:=]\s*[\"']?(\d+)[\"']?",
        text,
        re.I,
    )
    if m:
        return m.group(1)
    m = re.search(r"\bTask\s+#?(\d+)\b", text, re.I)
    if m:
        return m.group(1)
    m = re.search(r"\bcreated\b.*?(\d+)", text, re.I)
    if m:
        return m.group(1)
    return None


def apply_task_create(
    session: dict[str, Any],
    *,
    tool_use_id: str,
    payload: dict[str, Any],
    result_task_id: str | None = None,
) -> dict[str, Any]:
    """Create or finalize a task from TaskCreate input (+ optional tool result id)."""
    tasks = ensure_tasks_list(session)
    subject = _as_str(payload.get("subject")) or "Untitled task"
    description = _as_str(payload.get("description"))
    active_form = _as_str(payload.get("activeForm") or payload.get("active_form"))
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else None

    # Prefer explicit result id, else payload id, else next numeric.
    # Do NOT reuse tool_use_id as the task id.
    provisional = find_task(tasks, f"tmp:{tool_use_id}")
    task_id = result_task_id or _as_str(payload.get("id") or payload.get("taskId"))
    if not task_id:
        task_id = next_numeric_id(tasks)

    existing = find_task(tasks, task_id) or provisional
    now = _now_iso()
    if existing is None:
        task = {
            "id": str(task_id),
            "subject": subject,
            "description": description,
            "activeForm": active_form,
            "status": "pending",
            "metadata": metadata,
            "created_at": now,
            "updated_at": now,
            "source_tool_use_id": tool_use_id,
        }
        tasks.append(task)
    else:
        # Promote provisional id if needed
        existing["id"] = str(task_id)
        existing["subject"] = subject or existing.get("subject")
        if description is not None:
            existing["description"] = description
        if active_form is not None:
            existing["activeForm"] = active_form
        if metadata is not None:
            existing["metadata"] = metadata
        existing["status"] = existing.get("status") or "pending"
        existing["updated_at"] = now
        existing["source_tool_use_id"] = tool_use_id
        task = existing
        # Remove duplicate provisional if id changed
        session["tasks"] = [t for t in tasks if not (str(t.get("id")).startswith("tmp:") and t is not task and t.get("source_tool_use_id") == tool_use_id)]
        if task not in session["tasks"]:
            session["tasks"].append(task)

    session["updated_at"] = now
    return dict(task)


def apply_task_update(
    session: dict[str, Any],
    *,
    tool_use_id: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    """Update a task from TaskUpdate input. Returns updated task or None if missing."""
    tasks = ensure_tasks_list(session)
    task_id = _as_str(payload.get("taskId") or payload.get("task_id") or payload.get("id"))
    if not task_id:
        return None
    task = find_task(tasks, task_id)
    now = _now_iso()
    if task is None:
        # Create shell task so UI can still show updates arriving first.
        task = {
            "id": str(task_id),
            "subject": _as_str(payload.get("subject")) or f"Task {task_id}",
            "description": _as_str(payload.get("description")),
            "activeForm": _as_str(payload.get("activeForm") or payload.get("active_form")),
            "status": normalize_status(payload.get("status")) or "pending",
            "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else None,
            "created_at": now,
            "updated_at": now,
            "source_tool_use_id": tool_use_id,
        }
        tasks.append(task)
    else:
        if "subject" in payload and payload.get("subject") is not None:
            task["subject"] = _as_str(payload.get("subject")) or task.get("subject")
        if "description" in payload:
            task["description"] = _as_str(payload.get("description"))
        if "activeForm" in payload or "active_form" in payload:
            task["activeForm"] = _as_str(payload.get("activeForm") or payload.get("active_form"))
        status = normalize_status(payload.get("status"))
        if status is not None:
            if status == "deleted":
                # soft-delete: mark and keep for history, frontend can hide
                task["status"] = "deleted"
            else:
                task["status"] = status
        if isinstance(payload.get("metadata"), dict):
            task["metadata"] = payload.get("metadata")
        task["updated_at"] = now
        task["source_tool_use_id"] = tool_use_id

    # Remove deleted from active sort preference later in frontend; keep in store.
    session["updated_at"] = now
    return dict(task)


def provisional_create_from_tool_start(
    session: dict[str, Any],
    *,
    tool_use_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Create a temporary task keyed by tool use id before the tool result arrives."""
    tasks = ensure_tasks_list(session)
    temp_id = f"tmp:{tool_use_id}"
    existing = find_task(tasks, temp_id)
    now = _now_iso()
    subject = _as_str(payload.get("subject")) or "Untitled task"
    description = _as_str(payload.get("description"))
    active_form = _as_str(payload.get("activeForm") or payload.get("active_form"))
    if existing is None:
        task = {
            "id": temp_id,
            "subject": subject,
            "description": description,
            "activeForm": active_form,
            "status": "pending",
            "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else None,
            "created_at": now,
            "updated_at": now,
            "source_tool_use_id": tool_use_id,
            "provisional": True,
        }
        tasks.append(task)
    else:
        existing["subject"] = subject
        existing["description"] = description
        existing["activeForm"] = active_form
        existing["updated_at"] = now
        task = existing
    session["updated_at"] = now
    return dict(task)
