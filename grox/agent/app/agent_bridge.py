"""Claude Agent SDK bridge: map SDK messages → SSE events and run one turn."""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AgentDefinition,
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ClaudeSDKError,
    HookEventMessage,
    ResultMessage,
    StreamEvent,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .attachments import (
    MAX_ATTACHMENTS,
    MAX_UPLOAD_BYTES,
    build_prompt_with_attachments,
    normalize_path_attachments,
    prompt_as_sdk_query,
    public_attachments,
    save_upload_under_cwd,
)
from .auth import require_token
from .config import settings
from .sessions import get_session, save_session
from .sse import format_sse
from .tasks import (
    TASK_CREATE_TOOLS,
    TASK_TOOLS,
    TASK_UPDATE_TOOLS,
    apply_task_create,
    apply_task_update,
    parse_task_id_from_result,
    provisional_create_from_tool_start,
)

router = APIRouter(dependencies=[Depends(require_token)])

# session_id → active ClaudeSDKClient (for /stop interrupt)
_active_clients: dict[str, ClaudeSDKClient] = {}

# Predefined subagents invokable via the Claude Agent SDK Agent tool.
DEFAULT_SUBAGENTS: dict[str, AgentDefinition] = {
    "explore": AgentDefinition(
        description=(
            "Read-only exploration specialist. Use for searching the codebase, "
            "reading files, locating symbols, and summarizing findings without edits."
        ),
        prompt=(
            "You are an explore subagent. Prefer read/search tools. Do not modify "
            "files unless explicitly required. Return concise findings with paths."
        ),
        model="inherit",
    ),
    "shell": AgentDefinition(
        description=(
            "Command/diagnostics specialist. Use for shell commands, logs, process "
            "checks, and environment inspection."
        ),
        prompt=(
            "You are a shell subagent. Run focused commands, capture relevant output, "
            "and explain results briefly. Avoid destructive commands unless requested."
        ),
        model="inherit",
    ),
    "review": AgentDefinition(
        description=(
            "Code review specialist. Use for correctness, security, tests, and "
            "maintainability review of specific files or diffs."
        ),
        prompt=(
            "You are a review subagent. Inspect the provided scope carefully, list "
            "concrete issues with severity, and suggest minimal fixes."
        ),
        model="inherit",
    ),
    "general": AgentDefinition(
        description=(
            "General-purpose subagent for multi-step delegated work that does not "
            "fit explore/shell/review."
        ),
        prompt=(
            "You are a general subagent. Complete the delegated task thoroughly and "
            "return a clear summary of actions and outcomes."
        ),
        model="inherit",
    ),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _summarize(value: Any, *, limit: int = 240) -> str:
    """Short human-readable summary for tool input/output."""
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    elif isinstance(value, dict):
        # Prefer common command-like keys for Bash-style tools
        for key in ("command", "cmd", "query", "path", "file_path", "pattern", "description"):
            if key in value and isinstance(value[key], str):
                text = value[key]
                break
        else:
            try:
                import json

                text = json.dumps(value, ensure_ascii=False, default=str)
            except (TypeError, ValueError):
                text = str(value)
    elif isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, dict) and "text" in item:
                parts.append(str(item.get("text") or ""))
            else:
                parts.append(str(item))
        text = "\n".join(parts)
    else:
        text = str(value)
    text = text.strip()
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def normalize_context_usage(raw: Any) -> dict[str, Any] | None:
    """Normalize SDK ContextUsageResponse (camelCase) into a stable UI payload."""
    if not isinstance(raw, dict):
        return None
    total = raw.get("totalTokens", raw.get("total_tokens"))
    max_tokens = raw.get("maxTokens", raw.get("max_tokens"))
    raw_max = raw.get("rawMaxTokens", raw.get("raw_max_tokens"))
    percentage = raw.get("percentage")
    try:
        total_i = int(total) if total is not None else None
        max_i = int(max_tokens) if max_tokens is not None else None
        raw_max_i = int(raw_max) if raw_max is not None else None
        pct_f = float(percentage) if percentage is not None else None
    except (TypeError, ValueError):
        return None
    if total_i is None or max_i is None or max_i <= 0:
        return None
    if pct_f is None:
        pct_f = round(100.0 * total_i / max_i, 2)

    categories: list[dict[str, Any]] = []
    for item in raw.get("categories") or []:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        tokens = item.get("tokens")
        if not isinstance(name, str) or tokens is None:
            continue
        try:
            tok_i = int(tokens)
        except (TypeError, ValueError):
            continue
        cat: dict[str, Any] = {
            "name": name,
            "tokens": tok_i,
            "color": str(item.get("color") or ""),
        }
        if "isDeferred" in item:
            cat["is_deferred"] = bool(item.get("isDeferred"))
        categories.append(cat)

    out: dict[str, Any] = {
        "total_tokens": total_i,
        "max_tokens": max_i,
        "percentage": pct_f,
        "model": str(raw.get("model") or "") or None,
        "categories": categories,
        "updated_at": _now_iso(),
    }
    if raw_max_i is not None:
        out["raw_max_tokens"] = raw_max_i
    if "isAutoCompactEnabled" in raw:
        out["auto_compact"] = bool(raw.get("isAutoCompactEnabled"))
    if raw.get("autoCompactThreshold") is not None:
        try:
            out["auto_compact_threshold"] = int(raw["autoCompactThreshold"])
        except (TypeError, ValueError):
            pass
    return out


@dataclass
class TurnAccumulator:
    """Collect assistant text + tool cards for one turn of persistence."""

    text_parts: list[str] = field(default_factory=list)
    tools: list[dict[str, Any]] = field(default_factory=list)
    tools_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    # tool_use_id → pending task tool metadata for create/update finalization
    task_tool_meta: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Nested subagent state for live SSE + persistence under parent tools.
    subagents_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    # parent_tool_use_id → subagent id
    parent_to_subagent: dict[str, str] = field(default_factory=dict)
    # parent_tool_use_id → partial stream flag for that subagent
    subagent_streamed_partial: dict[str, bool] = field(default_factory=dict)
    sdk_session_id: str | None = None
    usage: dict[str, Any] | None = None
    total_cost_usd: float | None = None
    error_message: str | None = None
    context_usage: dict[str, Any] | None = None
    # True after token-level StreamEvent text was applied for the current
    # assistant message. Final AssistantMessage TextBlocks then skip re-add.
    streamed_via_partial: bool = False

    def add_text(self, text: str, *, from_partial: bool = False) -> None:
        if text:
            self.text_parts.append(text)
            if from_partial:
                self.streamed_via_partial = True

    def start_tool(self, tool_id: str, name: str, input_data: Any) -> dict[str, Any]:
        card = {
            "id": tool_id,
            "name": name,
            "input_summary": _summarize(input_data),
            "output_summary": "",
            "ok": True,
        }
        # Attach any subagent already linked to this parent tool.
        sub_id = self.parent_to_subagent.get(tool_id)
        if sub_id and sub_id in self.subagents_by_id:
            card["subagent"] = self.subagents_by_id[sub_id]
        self.tools.append(card)
        self.tools_by_id[tool_id] = card
        if name in TASK_TOOLS:
            payload = input_data if isinstance(input_data, dict) else {}
            self.task_tool_meta[tool_id] = {
                "name": name,
                "input": payload,
            }
        return card

    def end_tool(
        self,
        tool_id: str,
        *,
        output: Any = None,
        is_error: bool | None = None,
        name: str | None = None,
    ) -> dict[str, Any]:
        card = self.tools_by_id.get(tool_id)
        if card is None:
            card = {
                "id": tool_id,
                "name": name or "tool",
                "input_summary": "",
                "output_summary": "",
                "ok": True,
            }
            self.tools.append(card)
            self.tools_by_id[tool_id] = card
        if name and not card.get("name"):
            card["name"] = name
        card["output_summary"] = _summarize(output)
        if is_error is not None:
            card["ok"] = not bool(is_error)
        # Keep nested subagent snapshot fresh on the parent tool card.
        sub_id = self.parent_to_subagent.get(tool_id)
        if sub_id and sub_id in self.subagents_by_id:
            card["subagent"] = self.subagents_by_id[sub_id]
        return card

    def ensure_subagent(
        self,
        *,
        subagent_id: str,
        name: str | None = None,
        agent_type: str | None = None,
        parent_tool_use_id: str | None = None,
        status: str = "running",
    ) -> dict[str, Any]:
        sid = str(subagent_id)
        rec = self.subagents_by_id.get(sid)
        if rec is None:
            rec = {
                "id": sid,
                "name": name or agent_type or "subagent",
                "agent_type": agent_type or name or "subagent",
                "parent_tool_use_id": parent_tool_use_id,
                "status": status,
                "text": "",
                "tools": [],
            }
            self.subagents_by_id[sid] = rec
        else:
            if name:
                rec["name"] = name
            if agent_type:
                rec["agent_type"] = agent_type
            if parent_tool_use_id:
                rec["parent_tool_use_id"] = parent_tool_use_id
            if status:
                rec["status"] = status
        if parent_tool_use_id:
            self.parent_to_subagent[str(parent_tool_use_id)] = sid
            parent = self.tools_by_id.get(str(parent_tool_use_id))
            if parent is not None:
                parent["subagent"] = rec
        return rec

    def subagent_for_parent(self, parent_tool_use_id: str | None) -> dict[str, Any] | None:
        if not parent_tool_use_id:
            return None
        sid = self.parent_to_subagent.get(str(parent_tool_use_id))
        if sid and sid in self.subagents_by_id:
            return self.subagents_by_id[sid]
        # Synthetic id until a real SubagentStart arrives.
        return self.ensure_subagent(
            subagent_id=f"parent:{parent_tool_use_id}",
            name="subagent",
            agent_type="subagent",
            parent_tool_use_id=str(parent_tool_use_id),
            status="running",
        )

    def add_subagent_text(
        self,
        parent_tool_use_id: str | None,
        text: str,
        *,
        from_partial: bool = False,
        subagent_id: str | None = None,
    ) -> dict[str, Any] | None:
        if not text:
            return None
        if subagent_id:
            rec = self.ensure_subagent(
                subagent_id=subagent_id,
                parent_tool_use_id=parent_tool_use_id,
            )
        else:
            rec = self.subagent_for_parent(parent_tool_use_id)
        if rec is None:
            return None
        rec["text"] = (rec.get("text") or "") + text
        if from_partial and parent_tool_use_id:
            self.subagent_streamed_partial[str(parent_tool_use_id)] = True
        return rec

    def start_subagent_tool(
        self,
        parent_tool_use_id: str | None,
        tool_id: str,
        name: str,
        input_data: Any,
        *,
        subagent_id: str | None = None,
    ) -> tuple[dict[str, Any] | None, dict[str, Any]]:
        if subagent_id:
            rec = self.ensure_subagent(
                subagent_id=subagent_id,
                parent_tool_use_id=parent_tool_use_id,
            )
        else:
            rec = self.subagent_for_parent(parent_tool_use_id)
        card = {
            "id": tool_id,
            "name": name,
            "input_summary": _summarize(input_data),
            "output_summary": "",
            "ok": True,
        }
        if rec is not None:
            tools = list(rec.get("tools") or [])
            # Replace if same id already present.
            tools = [t for t in tools if t.get("id") != tool_id]
            tools.append(card)
            rec["tools"] = tools
        return rec, card

    def end_subagent_tool(
        self,
        parent_tool_use_id: str | None,
        tool_id: str,
        *,
        output: Any = None,
        is_error: bool | None = None,
        name: str | None = None,
        subagent_id: str | None = None,
    ) -> tuple[dict[str, Any] | None, dict[str, Any]]:
        if subagent_id:
            rec = self.ensure_subagent(
                subagent_id=subagent_id,
                parent_tool_use_id=parent_tool_use_id,
            )
        else:
            rec = self.subagent_for_parent(parent_tool_use_id)
        card: dict[str, Any] = {
            "id": tool_id,
            "name": name or "tool",
            "input_summary": "",
            "output_summary": _summarize(output),
            "ok": True if is_error is None else (not bool(is_error)),
        }
        if rec is not None:
            tools = list(rec.get("tools") or [])
            existing = next((t for t in tools if t.get("id") == tool_id), None)
            if existing is not None:
                existing["output_summary"] = card["output_summary"]
                if is_error is not None:
                    existing["ok"] = not bool(is_error)
                if name:
                    existing["name"] = name
                card = existing
            else:
                tools.append(card)
            rec["tools"] = tools
        return rec, card

    def content_text(self) -> str:
        return "".join(self.text_parts)

    def assistant_message(self) -> dict[str, Any]:
        # Ensure every parent tool card carries the latest nested subagent snapshot.
        for parent_id, sub_id in self.parent_to_subagent.items():
            card = self.tools_by_id.get(parent_id)
            sub = self.subagents_by_id.get(sub_id)
            if card is not None and sub is not None:
                card["subagent"] = sub
        return {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": self.content_text(),
            "tools": list(self.tools),
            "created_at": _now_iso(),
        }


def _task_events_for_tool_start(
    session: dict[str, Any] | None,
    *,
    tool_id: str,
    name: str,
    input_data: Any,
) -> list[dict[str, Any]]:
    if session is None or name not in TASK_TOOLS:
        return []
    payload = input_data if isinstance(input_data, dict) else {}
    events: list[dict[str, Any]] = []
    if name in TASK_CREATE_TOOLS:
        task = provisional_create_from_tool_start(
            session,
            tool_use_id=tool_id,
            payload=payload,
        )
        events.append(
            {
                "event": "task_create",
                "data": {
                    "task": task,
                    "tool_use_id": tool_id,
                    "provisional": True,
                },
            }
        )
    elif name in TASK_UPDATE_TOOLS:
        task = apply_task_update(
            session,
            tool_use_id=tool_id,
            payload=payload,
        )
        if task is not None:
            events.append(
                {
                    "event": "task_update",
                    "data": {
                        "task": task,
                        "tool_use_id": tool_id,
                        "patch": payload,
                    },
                }
            )
    return events


def _task_events_for_tool_end(
    session: dict[str, Any] | None,
    acc: TurnAccumulator | None,
    *,
    tool_id: str,
    name: str,
    output: Any,
    is_error: bool | None,
) -> list[dict[str, Any]]:
    if session is None or acc is None:
        return []
    meta = acc.task_tool_meta.get(tool_id)
    tool_name = (meta or {}).get("name") or name
    if tool_name not in TASK_TOOLS:
        return []
    if is_error:
        return []
    payload = (meta or {}).get("input") if isinstance((meta or {}).get("input"), dict) else {}
    events: list[dict[str, Any]] = []
    if tool_name in TASK_CREATE_TOOLS:
        result_id = parse_task_id_from_result(output)
        task = apply_task_create(
            session,
            tool_use_id=tool_id,
            payload=payload,
            result_task_id=result_id,
        )
        events.append(
            {
                "event": "task_create",
                "data": {
                    "task": task,
                    "tool_use_id": tool_id,
                    "provisional": False,
                },
            }
        )
    elif tool_name in TASK_UPDATE_TOOLS:
        # Re-apply with same payload to keep store consistent after success.
        task = apply_task_update(
            session,
            tool_use_id=tool_id,
            payload=payload,
        )
        if task is not None:
            events.append(
                {
                    "event": "task_update",
                    "data": {
                        "task": task,
                        "tool_use_id": tool_id,
                        "patch": payload,
                    },
                }
            )
    return events


def _stream_event_text_delta(raw_event: Any) -> str | None:
    """Extract incremental assistant text from a raw Anthropic stream event."""
    if not isinstance(raw_event, dict):
        return None
    if raw_event.get("type") != "content_block_delta":
        return None
    delta = raw_event.get("delta")
    if not isinstance(delta, dict):
        return None
    # text_delta is the main assistant token stream; ignore thinking/json deltas.
    if delta.get("type") != "text_delta":
        return None
    text = delta.get("text")
    if not isinstance(text, str) or not text:
        return None
    return text


def _hook_payload(msg: HookEventMessage) -> dict[str, Any]:
    """Normalize hook event payload from HookEventMessage.data."""
    data = msg.data if isinstance(msg.data, dict) else {}
    # Prefer nested input/payload if present; fall back to top-level keys.
    for key in ("input", "hook_input", "payload"):
        nested = data.get(key)
        if isinstance(nested, dict):
            merged = dict(nested)
            # Keep outer agent ids if nested lacks them.
            for k in ("agent_id", "agent_type", "parent_tool_use_id", "tool_use_id"):
                if k not in merged and k in data:
                    merged[k] = data[k]
            return merged
    return data


def _map_subagent_text(
    acc: TurnAccumulator | None,
    *,
    parent_tool_use_id: str | None,
    text: str,
    from_partial: bool = False,
) -> list[dict[str, Any]]:
    if not text:
        return []
    rec = None
    if acc is not None:
        rec = acc.add_subagent_text(
            parent_tool_use_id,
            text,
            from_partial=from_partial,
        )
    sid = (rec or {}).get("id") or (
        f"parent:{parent_tool_use_id}" if parent_tool_use_id else "subagent"
    )
    return [
        {
            "event": "subagent_text_delta",
            "data": {
                "id": sid,
                "text": text,
                "parent_tool_use_id": parent_tool_use_id,
            },
        }
    ]


def _map_subagent_tool_start(
    acc: TurnAccumulator | None,
    *,
    parent_tool_use_id: str | None,
    tool_id: str,
    name: str,
    input_data: Any,
) -> list[dict[str, Any]]:
    rec = None
    card = {
        "id": tool_id,
        "name": name,
        "input_summary": _summarize(input_data),
        "output_summary": "",
        "ok": True,
    }
    if acc is not None:
        rec, card = acc.start_subagent_tool(
            parent_tool_use_id,
            tool_id,
            name,
            input_data,
        )
    sid = (rec or {}).get("id") or (
        f"parent:{parent_tool_use_id}" if parent_tool_use_id else "subagent"
    )
    return [
        {
            "event": "subagent_tool_start",
            "data": {
                "id": sid,
                "parent_tool_use_id": parent_tool_use_id,
                "tool": card,
            },
        }
    ]


def _map_subagent_tool_end(
    acc: TurnAccumulator | None,
    *,
    parent_tool_use_id: str | None,
    tool_id: str,
    output: Any = None,
    is_error: bool | None = None,
    name: str | None = None,
) -> list[dict[str, Any]]:
    rec = None
    card = {
        "id": tool_id,
        "name": name or "tool",
        "input_summary": "",
        "output_summary": _summarize(output),
        "ok": True if is_error is None else (not bool(is_error)),
    }
    if acc is not None:
        rec, card = acc.end_subagent_tool(
            parent_tool_use_id,
            tool_id,
            output=output,
            is_error=is_error,
            name=name,
        )
    sid = (rec or {}).get("id") or (
        f"parent:{parent_tool_use_id}" if parent_tool_use_id else "subagent"
    )
    return [
        {
            "event": "subagent_tool_end",
            "data": {
                "id": sid,
                "parent_tool_use_id": parent_tool_use_id,
                "tool": card,
            },
        }
    ]


def map_sdk_message(
    msg: Any,
    acc: TurnAccumulator | None = None,
    *,
    session: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Map one SDK message object to zero or more SSE event dicts.

    Each event is ``{"event": str, "data": dict}`` (data not yet JSON-encoded).
    """
    events: list[dict[str, Any]] = []

    # Subagent lifecycle hooks (requires include_hook_events=True).
    if isinstance(msg, HookEventMessage):
        hook_name = (
            getattr(msg, "hook_event_name", None)
            or (msg.data or {}).get("hook_event")
            or (msg.data or {}).get("hook_event_name")
            or ""
        )
        payload = _hook_payload(msg)
        agent_id = payload.get("agent_id") or payload.get("id")
        agent_type = payload.get("agent_type") or payload.get("name")
        parent_id = (
            payload.get("parent_tool_use_id")
            or payload.get("tool_use_id")
            or payload.get("parent_tool_id")
        )
        if hook_name == "SubagentStart" and agent_id:
            rec = None
            if acc is not None:
                rec = acc.ensure_subagent(
                    subagent_id=str(agent_id),
                    name=str(agent_type or "subagent"),
                    agent_type=str(agent_type or "subagent"),
                    parent_tool_use_id=str(parent_id) if parent_id else None,
                    status="running",
                )
            events.append(
                {
                    "event": "subagent_start",
                    "data": {
                        "id": str(agent_id),
                        "name": (rec or {}).get("name") or str(agent_type or "subagent"),
                        "agent_type": (rec or {}).get("agent_type")
                        or str(agent_type or "subagent"),
                        "parent_tool_use_id": str(parent_id) if parent_id else None,
                        "status": "running",
                    },
                }
            )
            return events
        if hook_name == "SubagentStop" and agent_id:
            status = "done"
            if payload.get("is_error") or payload.get("error"):
                status = "error"
            summary = payload.get("summary") or payload.get("result")
            if acc is not None:
                rec = acc.ensure_subagent(
                    subagent_id=str(agent_id),
                    name=str(agent_type or "subagent"),
                    agent_type=str(agent_type or "subagent"),
                    parent_tool_use_id=str(parent_id) if parent_id else None,
                    status=status,
                )
                if summary:
                    rec["summary"] = _summarize(summary, limit=400)
            events.append(
                {
                    "event": "subagent_done",
                    "data": {
                        "id": str(agent_id),
                        "status": status,
                        "summary": _summarize(summary, limit=400) if summary else None,
                        "parent_tool_use_id": str(parent_id) if parent_id else None,
                    },
                }
            )
            return events
        # Other hooks are ignored by the chat UI.
        return events

    if isinstance(msg, StreamEvent):
        # Token-level partials (requires include_partial_messages=True).
        if acc is not None and msg.session_id and not acc.sdk_session_id:
            acc.sdk_session_id = msg.session_id
        text = _stream_event_text_delta(msg.event)
        if not text:
            return events
        parent_id = getattr(msg, "parent_tool_use_id", None)
        if parent_id:
            return _map_subagent_text(
                acc,
                parent_tool_use_id=str(parent_id),
                text=text,
                from_partial=True,
            )
        if acc is not None:
            acc.add_text(text, from_partial=True)
        events.append({"event": "text_delta", "data": {"text": text}})
        return events

    if isinstance(msg, AssistantMessage):
        content = msg.content or []
        parent_id = getattr(msg, "parent_tool_use_id", None)
        # Final assistant message after partial stream: text was already
        # accumulated from StreamEvent deltas — do not double-count / re-emit.
        if parent_id:
            skip_text = bool(
                acc is not None
                and acc.subagent_streamed_partial.get(str(parent_id))
            )
            if skip_text and acc is not None:
                acc.subagent_streamed_partial[str(parent_id)] = False
        else:
            skip_text = bool(acc is not None and acc.streamed_via_partial)
            if skip_text and acc is not None:
                # Reset so the next assistant message in this turn (after tools)
                # can stream/accumulate cleanly.
                acc.streamed_via_partial = False
        for block in content:
            if isinstance(block, TextBlock):
                text = block.text or ""
                if skip_text:
                    continue
                if parent_id:
                    events.extend(
                        _map_subagent_text(
                            acc,
                            parent_tool_use_id=str(parent_id),
                            text=text,
                        )
                    )
                    continue
                if acc is not None:
                    acc.add_text(text)
                if text:
                    events.append({"event": "text_delta", "data": {"text": text}})
            elif isinstance(block, ToolUseBlock):
                tool_id = block.id
                name = block.name
                input_data = block.input
                if parent_id:
                    events.extend(
                        _map_subagent_tool_start(
                            acc,
                            parent_tool_use_id=str(parent_id),
                            tool_id=tool_id,
                            name=name,
                            input_data=input_data,
                        )
                    )
                    continue
                if acc is not None:
                    acc.start_tool(tool_id, name, input_data)
                events.append(
                    {
                        "event": "tool_start",
                        "data": {
                            "id": tool_id,
                            "name": name,
                            "input_summary": _summarize(input_data),
                        },
                    }
                )
                events.extend(
                    _task_events_for_tool_start(
                        session,
                        tool_id=tool_id,
                        name=name,
                        input_data=input_data,
                    )
                )
            elif isinstance(block, ToolResultBlock):
                # Rare on assistant; still map for robustness
                tool_id = block.tool_use_id
                if parent_id:
                    events.extend(
                        _map_subagent_tool_end(
                            acc,
                            parent_tool_use_id=str(parent_id),
                            tool_id=tool_id,
                            output=block.content,
                            is_error=block.is_error,
                        )
                    )
                    continue
                if acc is not None:
                    card = acc.end_tool(
                        tool_id,
                        output=block.content,
                        is_error=block.is_error,
                    )
                    name = card.get("name") or "tool"
                else:
                    name = "tool"
                events.append(
                    {
                        "event": "tool_end",
                        "data": {
                            "id": tool_id,
                            "name": name,
                            "ok": not bool(block.is_error),
                            "output_summary": _summarize(block.content),
                        },
                    }
                )
                events.extend(
                    _task_events_for_tool_end(
                        session,
                        acc,
                        tool_id=tool_id,
                        name=name,
                        output=block.content,
                        is_error=block.is_error,
                    )
                )
        if msg.error:
            err = f"Assistant error: {msg.error}"
            if acc is not None:
                acc.error_message = err
            events.append({"event": "error", "data": {"message": err}})
        return events

    if isinstance(msg, UserMessage):
        content = msg.content
        parent_id = getattr(msg, "parent_tool_use_id", None)
        blocks: Iterable[Any]
        if isinstance(content, str):
            return events
        blocks = content or []
        for block in blocks:
            if isinstance(block, ToolResultBlock):
                tool_id = block.tool_use_id
                if parent_id:
                    events.extend(
                        _map_subagent_tool_end(
                            acc,
                            parent_tool_use_id=str(parent_id),
                            tool_id=tool_id,
                            output=block.content,
                            is_error=block.is_error,
                        )
                    )
                    continue
                name = "tool"
                if acc is not None:
                    card = acc.end_tool(
                        tool_id,
                        output=block.content,
                        is_error=block.is_error,
                    )
                    name = card.get("name") or name
                events.append(
                    {
                        "event": "tool_end",
                        "data": {
                            "id": tool_id,
                            "name": name,
                            "ok": not bool(block.is_error),
                            "output_summary": _summarize(block.content),
                        },
                    }
                )
                events.extend(
                    _task_events_for_tool_end(
                        session,
                        acc,
                        tool_id=tool_id,
                        name=name,
                        output=block.content,
                        is_error=block.is_error,
                    )
                )
        return events

    if isinstance(msg, ResultMessage):
        if acc is not None:
            acc.sdk_session_id = msg.session_id or acc.sdk_session_id
            acc.usage = msg.usage if isinstance(msg.usage, dict) else acc.usage
            acc.total_cost_usd = msg.total_cost_usd
            if msg.is_error:
                if msg.errors:
                    acc.error_message = "; ".join(str(e) for e in msg.errors)
                elif msg.result:
                    acc.error_message = str(msg.result)
                else:
                    acc.error_message = "Agent turn failed"
        if msg.is_error:
            message = (
                "; ".join(str(e) for e in msg.errors)
                if msg.errors
                else (msg.result or "Agent turn failed")
            )
            events.append({"event": "error", "data": {"message": message}})
        data: dict[str, Any] = {
            "sdk_session_id": msg.session_id,
            "usage": msg.usage if isinstance(msg.usage, dict) else None,
        }
        if msg.total_cost_usd is not None:
            data["total_cost_usd"] = msg.total_cost_usd
        if msg.stop_reason is not None:
            data["stop_reason"] = msg.stop_reason
        events.append({"event": "done", "data": data})
        return events

    # Unknown / system / stream events: ignore for SSE UI
    return events


def map_exception(exc: BaseException) -> dict[str, Any]:
    """Map an exception to an SSE error event dict."""
    message = str(exc) or exc.__class__.__name__
    return {"event": "error", "data": {"message": message}}


def claude_project_dir_for_cwd(cwd: str | None) -> Path | None:
    """Map a chat session cwd to Claude Code's projects/<slug> directory."""
    if not cwd:
        return None
    try:
        resolved = str(Path(cwd).expanduser().resolve())
    except Exception:
        resolved = str(cwd)
    # Claude Code encodes absolute paths by replacing '/' with '-'.
    slug = resolved.replace("/", "-")
    return Path.home() / ".claude" / "projects" / slug


def is_resumable_sdk_session(sdk_session_id: str | None, cwd: str | None) -> bool:
    """True when a Claude transcript exists for this session under the given cwd."""
    sid = (sdk_session_id or "").strip()
    if not sid:
        return False
    project_dir = claude_project_dir_for_cwd(cwd)
    if project_dir is None:
        return False
    return (project_dir / f"{sid}.jsonl").is_file()


def is_missing_resume_session_error(exc: BaseException) -> bool:
    """Detect Claude CLI/SDK failures caused by a stale --resume session id."""
    text = str(exc) or ""
    lowered = text.lower()
    if "no conversation found with session id" in lowered:
        return True
    # SDK often wraps the real CLI message as a generic ProcessError.
    if "command failed with exit code 1" in lowered and "stderr" in lowered:
        return True
    return False


def clear_sdk_session_id(session: dict[str, Any]) -> dict[str, Any]:
    """Drop a stale resume id so the next turn starts a fresh Claude conversation."""
    if session.get("sdk_session_id"):
        session["sdk_session_id"] = None
        save_session(session)
    return session


def configured_skills() -> str | list[str]:
    """Normalize GROX_CHAT_SKILLS into the Agent SDK skills option."""
    raw = str(settings.chat_skills or "all").strip()
    lowered = raw.lower()
    if lowered == "all":
        return "all"
    if lowered in {"", "none", "off", "false", "disabled"}:
        return []
    return [name.strip() for name in raw.split(",") if name.strip()]


def build_options(
    session: dict[str, Any],
    *,
    validate_resume: bool = True,
) -> ClaudeAgentOptions:
    """Build ClaudeAgentOptions from a chat session record."""
    base_url = settings.anthropic_base_url.rstrip("/")
    os.environ["ANTHROPIC_BASE_URL"] = base_url
    env: dict[str, str] = {
        "ANTHROPIC_BASE_URL": base_url,
    }
    if settings.anthropic_api_key:
        os.environ["ANTHROPIC_API_KEY"] = settings.anthropic_api_key
        env["ANTHROPIC_API_KEY"] = settings.anthropic_api_key
    else:
        # Drop a previously set key so an empty runtime config cannot reuse it.
        os.environ.pop("ANTHROPIC_API_KEY", None)
        env.pop("ANTHROPIC_API_KEY", None)
    # Ensure PATH is present (SDK merges os.environ, but keep explicit for clarity)
    path = os.environ.get("PATH")
    if path:
        env["PATH"] = path

    kwargs: dict[str, Any] = {
        "cwd": session.get("cwd"),
        "model": session.get("model") or settings.chat_default_model,
        "permission_mode": settings.chat_permission_mode or "bypassPermissions",
        "env": env,
        # Emit token-level StreamEvent partials so the UI can type out text
        # instead of waiting for a whole AssistantMessage block.
        "include_partial_messages": True,
        # Subagent lifecycle hooks → nested SSE cards in the chat UI.
        "include_hook_events": True,
        "agents": DEFAULT_SUBAGENTS,
        # The SDK requires the dedicated skills option; permission bypass alone
        # exposes the Skill tool but does not load/discover its skill registry.
        "skills": configured_skills(),
        "setting_sources": ["user", "project", "local"],
    }
    resume = session.get("sdk_session_id")
    # Only resume when the transcript exists under the current cwd. Otherwise the
    # CLI exits 1 with "No conversation found with session ID".
    if resume and (
        not validate_resume
        or is_resumable_sdk_session(resume, session.get("cwd"))
    ):
        kwargs["resume"] = resume
    elif resume:
        clear_sdk_session_id(session)
    return ClaudeAgentOptions(**kwargs)


def register_client(session_id: str, client: ClaudeSDKClient) -> None:
    _active_clients[session_id] = client


def unregister_client(session_id: str, client: ClaudeSDKClient | None = None) -> None:
    current = _active_clients.get(session_id)
    if current is None:
        return
    if client is None or current is client:
        _active_clients.pop(session_id, None)


def get_active_client(session_id: str) -> ClaudeSDKClient | None:
    return _active_clients.get(session_id)


async def interrupt_session(session_id: str) -> bool:
    """
    Best-effort interrupt of a running turn.

    Returns True if a client was found and interrupt was attempted.
    """
    client = _active_clients.get(session_id)
    if client is None:
        return False
    try:
        await client.interrupt()
    except Exception:
        # Best-effort; caller decides status codes
        return True
    return True


def append_user_message(
    session: dict[str, Any],
    content: str,
    *,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Persist a user message onto the session and return the message dict."""
    msg: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "role": "user",
        "content": content,
        "created_at": _now_iso(),
    }
    if attachments:
        msg["attachments"] = public_attachments(attachments)
    messages = list(session.get("messages") or [])
    messages.append(msg)
    session["messages"] = messages
    session["updated_at"] = _now_iso()
    save_session(session)
    return msg


def set_session_status(session_id: str, status: str) -> dict[str, Any]:
    session = get_session(session_id)
    session["status"] = status
    session["updated_at"] = _now_iso()
    save_session(session)
    return session


def finalize_turn(
    session_id: str,
    acc: TurnAccumulator,
    *,
    live_session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Append assistant message (if any content/tools), save sdk_session_id/tasks, set idle."""
    session = get_session(session_id)
    # Merge task list mutated during the turn (live_session) into persisted record.
    if live_session is not None and isinstance(live_session.get("tasks"), list):
        session["tasks"] = live_session.get("tasks")
    elif "tasks" not in session:
        session["tasks"] = []
    text = acc.content_text()
    if text or acc.tools:
        messages = list(session.get("messages") or [])
        messages.append(acc.assistant_message())
        session["messages"] = messages
    if acc.sdk_session_id:
        session["sdk_session_id"] = acc.sdk_session_id
    if acc.context_usage:
        session["context_usage"] = acc.context_usage
    if acc.usage:
        session["last_usage"] = acc.usage
    if acc.total_cost_usd is not None:
        session["last_cost_usd"] = acc.total_cost_usd
    session["status"] = "idle"
    session["updated_at"] = _now_iso()
    save_session(session)
    return session


async def run_agent_turn(
    session_id: str,
    user_text: str,
    *,
    attachments: list[dict[str, Any]] | None = None,
    client_factory: Any | None = None,
    disconnect_check: Any | None = None,
) -> AsyncIterator[Any]:
    """
    Run one agent turn and yield ServerSentEvent objects.

    ``client_factory`` is an optional callable ``(options) -> async context manager``
    used by unit tests to inject a fake ClaudeSDKClient.

    ``disconnect_check`` is an optional async callable returning True when the
    HTTP client has disconnected (best-effort interrupt).

    ``attachments`` is an optional list of path attachments under session cwd.
    Images are embedded as multimodal content; other paths are listed for tools.
    """
    session = get_session(session_id)
    if session.get("status") == "running":
        yield format_sse("error", {"message": "Session is already running"})
        yield format_sse("done", {"sdk_session_id": session.get("sdk_session_id"), "usage": None})
        return

    cwd = str(session.get("cwd") or "")
    try:
        normalized_atts = normalize_path_attachments(cwd, attachments)
    except HTTPException as exc:
        # Surface validation errors as SSE so the UI stream path stays uniform.
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        yield format_sse("error", {"message": detail})
        yield format_sse("done", {"sdk_session_id": session.get("sdk_session_id"), "usage": None})
        return

    prompt, public_atts = build_prompt_with_attachments(user_text, normalized_atts)

    # Persist user message first (store original text + public attachment meta).
    append_user_message(session, user_text, attachments=public_atts or None)
    session = set_session_status(session_id, "running")
    # Live mutable session for task list updates during the turn.
    if not isinstance(session.get("tasks"), list):
        session["tasks"] = []

    meta = {
        "session_id": session_id,
        "cwd": session.get("cwd"),
        "model": session.get("model"),
        "tasks": list(session.get("tasks") or []),
        "attachments": public_atts,
    }
    if isinstance(session.get("context_usage"), dict):
        meta["context_usage"] = session["context_usage"]
    yield format_sse("meta", meta)

    acc = TurnAccumulator()
    options = build_options(session)
    factory = client_factory or ClaudeSDKClient
    client: ClaudeSDKClient | None = None
    done_emitted = False
    done_payload: dict[str, Any] | None = None
    resume_retried = False

    async def _run_with_options(active_options: ClaudeAgentOptions) -> None:
        nonlocal client, done_emitted, done_payload
        async with factory(options=active_options) as client:
            register_client(session_id, client)
            if isinstance(prompt, str):
                await client.query(prompt)
            else:
                await client.query(prompt_as_sdk_query(prompt))
            async for msg in client.receive_response():
                if disconnect_check is not None:
                    try:
                        if await disconnect_check():
                            await interrupt_session(session_id)
                            break
                    except Exception:
                        pass
                for event in map_sdk_message(msg, acc, session=session):
                    if event["event"] == "done":
                        done_emitted = True
                        # Defer done until after context usage is fetched so the
                        # UI gets a complete snapshot in one event when possible.
                        done_payload = dict(event["data"] or {})
                    else:
                        yield event

            # Still connected: pull /context-equivalent window breakdown.
            getter = getattr(client, "get_context_usage", None)
            if callable(getter):
                try:
                    raw_ctx = await getter()
                    normalized = normalize_context_usage(raw_ctx)
                    if normalized:
                        acc.context_usage = normalized
                        yield {"event": "context_usage", "data": normalized}
                except Exception:
                    # Best-effort: older CLI / failed probe should not fail the turn.
                    pass

    try:
        while True:
            try:
                async for event in _run_with_options(options):
                    yield format_sse(event["event"], event["data"])
                break
            except (ClaudeSDKError, Exception) as exc:
                # Stale resume id (cwd mismatch / deleted transcript): drop it once
                # and restart the turn as a fresh Claude conversation.
                if (
                    not resume_retried
                    and getattr(options, "resume", None)
                    and is_missing_resume_session_error(exc)
                ):
                    resume_retried = True
                    clear_sdk_session_id(session)
                    options = build_options(session)
                    if client is not None:
                        unregister_client(session_id, client)
                        client = None
                    continue
                err = map_exception(exc)
                yield format_sse(err["event"], err["data"])
                break
    finally:
        if client is not None:
            unregister_client(session_id, client)
        try:
            finalize_turn(session_id, acc, live_session=session)
        except Exception:
            # Last-resort: try mark idle without losing prior messages
            try:
                set_session_status(session_id, "idle")
            except Exception:
                pass

    def _done_data(base: dict[str, Any] | None = None) -> dict[str, Any]:
        data: dict[str, Any] = dict(base or {})
        data.setdefault("sdk_session_id", acc.sdk_session_id)
        data.setdefault("usage", acc.usage)
        data["tasks"] = list(session.get("tasks") or [])
        if acc.context_usage:
            data["context_usage"] = acc.context_usage
        if acc.total_cost_usd is not None:
            data.setdefault("total_cost_usd", acc.total_cost_usd)
        return data

    if done_emitted and done_payload is not None:
        yield format_sse("done", _done_data(done_payload))
    elif not done_emitted:
        yield format_sse("done", _done_data())


class PathAttachment(BaseModel):
    type: str = "path"
    path: str = Field(..., min_length=1)


class PostMessageRequest(BaseModel):
    content: str = Field(default="")
    attachments: list[PathAttachment] | None = None


class ResolvePathRequest(BaseModel):
    path: str = Field(..., min_length=1)


@router.post("/api/sessions/{session_id}/messages")
async def api_post_message(
    session_id: str,
    payload: PostMessageRequest,
    request: Request,
) -> EventSourceResponse:
    # Validate session exists before opening the stream
    get_session(session_id)

    content = (payload.content or "").strip()
    raw_atts = (
        [a.model_dump() for a in payload.attachments] if payload.attachments else None
    )
    if not content and not raw_atts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="content or attachments required",
        )

    async def event_generator() -> AsyncIterator[Any]:
        async def _disconnected() -> bool:
            return await request.is_disconnected()

        async for event in run_agent_turn(
            session_id,
            content,
            attachments=raw_atts,
            disconnect_check=_disconnected,
        ):
            yield event
            if await request.is_disconnected():
                await interrupt_session(session_id)
                break

    return EventSourceResponse(
        event_generator(),
        media_type="text/event-stream",
        ping=15,
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/sessions/{session_id}/attachments/resolve")
def api_resolve_attachment_path(
    session_id: str,
    payload: ResolvePathRequest,
) -> dict[str, Any]:
    """Validate a project path under the session cwd (for Composer chips)."""
    session = get_session(session_id)
    items = normalize_path_attachments(str(session.get("cwd") or ""), [
        {"type": "path", "path": payload.path},
    ])
    if not items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="path could not be resolved",
        )
    return public_attachments(items)[0]


@router.post("/api/sessions/{session_id}/attachments/upload")
async def api_upload_attachment(
    session_id: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """
    Accept a dragged/selected browser file, store under
    ``{cwd}/.chat-attachments/{session_id}/``, return a path attachment.
    """
    session = get_session(session_id)
    if session.get("status") == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot upload while session is running",
        )
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"file too large (>{MAX_UPLOAD_BYTES} bytes)",
        )
    item = save_upload_under_cwd(
        str(session.get("cwd") or ""),
        session_id,
        filename=file.filename or "upload.bin",
        data=raw,
        content_type=file.content_type,
    )
    return item


@router.post("/api/sessions/{session_id}/stop")
async def api_stop_session(session_id: str) -> dict[str, Any]:
    session = get_session(session_id)
    has_client = get_active_client(session_id) is not None
    if session.get("status") != "running" and not has_client:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session is not running",
        )

    interrupted = await interrupt_session(session_id)
    # Stuck status with no live client: force idle so session is usable again.
    if not has_client and session.get("status") == "running":
        set_session_status(session_id, "idle")
        return {"ok": True, "interrupted": False}

    # Live interrupt is best-effort; turn finalizer sets status=idle.
    return {"ok": True, "interrupted": interrupted}


def _extract_compact_summary(acc: TurnAccumulator) -> str:
    """Prefer assistant text from the compact turn; fallback to a short notice."""
    text = (acc.content_text() or "").strip()
    if text:
        return text
    return (
        "Conversation compacted. Earlier turns were summarized to free context "
        "window space. Continue from here."
    )


async def run_compact_session(
    session_id: str,
    *,
    client_factory: Any | None = None,
) -> dict[str, Any]:
    """
    Run Claude Code `/compact` against the resumed SDK session.

    Compaction is a short agent turn that summarizes prior context. We keep the
    existing chat transcript in the UI (so history remains browsable) and append
    a system marker + the compact summary as an assistant message.
    """
    session = get_session(session_id)
    if session.get("status") == "running" or get_active_client(session_id) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot compact while session is running",
        )
    if not session.get("sdk_session_id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session has no agent history to compact yet",
        )
    if not (session.get("messages") or []):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No messages to compact",
        )

    set_session_status(session_id, "running")
    acc = TurnAccumulator()
    # Compaction explicitly targets the SDK session stored on the record. Let
    # the SDK report a stale id instead of silently starting a new conversation
    # when the local transcript is unavailable to this process.
    options = build_options(session, validate_resume=False)
    factory = client_factory or ClaudeSDKClient
    client: ClaudeSDKClient | None = None
    error_message: str | None = None

    try:
        async with factory(options=options) as client:
            register_client(session_id, client)
            # Slash command handled by Claude Code CLI — same as interactive /compact.
            await client.query("/compact")
            async for msg in client.receive_response():
                map_sdk_message(msg, acc, session=session)

            getter = getattr(client, "get_context_usage", None)
            if callable(getter):
                try:
                    raw_ctx = await getter()
                    normalized = normalize_context_usage(raw_ctx)
                    if normalized:
                        acc.context_usage = normalized
                except Exception:
                    pass
    except ClaudeSDKError as exc:
        error_message = str(exc) or exc.__class__.__name__
    except Exception as exc:  # noqa: BLE001
        error_message = str(exc) or exc.__class__.__name__
    finally:
        if client is not None:
            unregister_client(session_id, client)

    # Always restore idle; on failure do not rewrite transcript.
    session = get_session(session_id)
    if error_message:
        session["status"] = "idle"
        session["updated_at"] = _now_iso()
        save_session(session)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Compact failed: {error_message}",
        )

    summary = _extract_compact_summary(acc)
    now = _now_iso()
    messages = list(session.get("messages") or [])
    messages.append(
        {
            "id": str(uuid.uuid4()),
            "role": "system",
            "content": "Context compacted — earlier turns were summarized to free window space.",
            "kind": "compact_boundary",
            "created_at": now,
        }
    )
    messages.append(
        {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": summary,
            "kind": "compact_summary",
            "tools": list(acc.tools),
            "created_at": now,
        }
    )
    session["messages"] = messages
    if acc.sdk_session_id:
        session["sdk_session_id"] = acc.sdk_session_id
    if acc.context_usage:
        session["context_usage"] = acc.context_usage
    if acc.usage:
        session["last_usage"] = acc.usage
    session["compacted_at"] = now
    session["status"] = "idle"
    session["updated_at"] = now
    save_session(session)
    return session


@router.post("/api/sessions/{session_id}/compact")
async def api_compact_session(session_id: str) -> dict[str, Any]:
    """Manually compact the agent conversation (Claude Code /compact)."""
    return await run_compact_session(session_id)
