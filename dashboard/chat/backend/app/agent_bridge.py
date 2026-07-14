"""Claude Agent SDK bridge: map SDK messages → SSE events and run one turn."""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ClaudeSDKError,
    ResultMessage,
    StreamEvent,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

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


@dataclass
class TurnAccumulator:
    """Collect assistant text + tool cards for one turn of persistence."""

    text_parts: list[str] = field(default_factory=list)
    tools: list[dict[str, Any]] = field(default_factory=list)
    tools_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    # tool_use_id → pending task tool metadata for create/update finalization
    task_tool_meta: dict[str, dict[str, Any]] = field(default_factory=dict)
    sdk_session_id: str | None = None
    usage: dict[str, Any] | None = None
    total_cost_usd: float | None = None
    error_message: str | None = None
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
        return card

    def content_text(self) -> str:
        return "".join(self.text_parts)

    def assistant_message(self) -> dict[str, Any]:
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

    if isinstance(msg, StreamEvent):
        # Token-level partials (requires include_partial_messages=True).
        if acc is not None and msg.session_id and not acc.sdk_session_id:
            acc.sdk_session_id = msg.session_id
        text = _stream_event_text_delta(msg.event)
        if text:
            if acc is not None:
                acc.add_text(text, from_partial=True)
            events.append({"event": "text_delta", "data": {"text": text}})
        return events

    if isinstance(msg, AssistantMessage):
        content = msg.content or []
        # Final assistant message after partial stream: text was already
        # accumulated from StreamEvent deltas — do not double-count / re-emit.
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
                if acc is not None:
                    acc.add_text(text)
                if text:
                    events.append({"event": "text_delta", "data": {"text": text}})
            elif isinstance(block, ToolUseBlock):
                tool_id = block.id
                name = block.name
                input_data = block.input
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
        blocks: Iterable[Any]
        if isinstance(content, str):
            return events
        blocks = content or []
        for block in blocks:
            if isinstance(block, ToolResultBlock):
                tool_id = block.tool_use_id
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


def build_options(session: dict[str, Any]) -> ClaudeAgentOptions:
    """Build ClaudeAgentOptions from a chat session record."""
    env: dict[str, str] = {
        "ANTHROPIC_BASE_URL": settings.anthropic_base_url,
    }
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
    }
    resume = session.get("sdk_session_id")
    if resume:
        kwargs["resume"] = resume
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


def append_user_message(session: dict[str, Any], content: str) -> dict[str, Any]:
    """Persist a user message onto the session and return the message dict."""
    msg = {
        "id": str(uuid.uuid4()),
        "role": "user",
        "content": content,
        "created_at": _now_iso(),
    }
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
    session["status"] = "idle"
    session["updated_at"] = _now_iso()
    save_session(session)
    return session


async def run_agent_turn(
    session_id: str,
    user_text: str,
    *,
    client_factory: Any | None = None,
    disconnect_check: Any | None = None,
) -> AsyncIterator[Any]:
    """
    Run one agent turn and yield ServerSentEvent objects.

    ``client_factory`` is an optional callable ``(options) -> async context manager``
    used by unit tests to inject a fake ClaudeSDKClient.

    ``disconnect_check`` is an optional async callable returning True when the
    HTTP client has disconnected (best-effort interrupt).
    """
    session = get_session(session_id)
    if session.get("status") == "running":
        yield format_sse("error", {"message": "Session is already running"})
        yield format_sse("done", {"sdk_session_id": session.get("sdk_session_id"), "usage": None})
        return

    # Persist user message first
    append_user_message(session, user_text)
    session = set_session_status(session_id, "running")
    # Live mutable session for task list updates during the turn.
    if not isinstance(session.get("tasks"), list):
        session["tasks"] = []

    meta = {
        "session_id": session_id,
        "cwd": session.get("cwd"),
        "model": session.get("model"),
        "tasks": list(session.get("tasks") or []),
    }
    yield format_sse("meta", meta)

    acc = TurnAccumulator()
    options = build_options(session)
    factory = client_factory or ClaudeSDKClient
    client: ClaudeSDKClient | None = None
    done_emitted = False

    try:
        async with factory(options=options) as client:
            register_client(session_id, client)
            await client.query(user_text)
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
                    yield format_sse(event["event"], event["data"])
    except ClaudeSDKError as exc:
        err = map_exception(exc)
        yield format_sse(err["event"], err["data"])
    except Exception as exc:  # noqa: BLE001 — surface any failure as SSE error
        err = map_exception(exc)
        yield format_sse(err["event"], err["data"])
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

    if not done_emitted:
        yield format_sse(
            "done",
            {
                "sdk_session_id": acc.sdk_session_id,
                "usage": acc.usage,
                "tasks": list(session.get("tasks") or []),
                **(
                    {"total_cost_usd": acc.total_cost_usd}
                    if acc.total_cost_usd is not None
                    else {}
                ),
            },
        )


class PostMessageRequest(BaseModel):
    content: str = Field(..., min_length=1)


@router.post("/api/sessions/{session_id}/messages")
async def api_post_message(
    session_id: str,
    payload: PostMessageRequest,
    request: Request,
) -> EventSourceResponse:
    # Validate session exists before opening the stream
    get_session(session_id)

    content = payload.content.strip()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="content must not be empty",
        )

    async def event_generator() -> AsyncIterator[Any]:
        async def _disconnected() -> bool:
            return await request.is_disconnected()

        async for event in run_agent_turn(
            session_id,
            content,
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
