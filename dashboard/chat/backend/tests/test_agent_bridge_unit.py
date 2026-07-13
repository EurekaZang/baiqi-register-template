"""Unit tests for agent bridge helpers (no live Claude CLI)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from fastapi.testclient import TestClient

from app import agent_bridge
from app.agent_bridge import (
    TurnAccumulator,
    build_options,
    finalize_turn,
    map_sdk_message,
    run_agent_turn,
)
from app.config import settings
from app.main import app
from app.sessions import create_session, get_session


def _auth_headers():
    return {"Authorization": "Bearer secret-token"}


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    monkeypatch.setattr(settings, "chat_token", "secret-token")
    monkeypatch.setattr(settings, "sessions_dir", sessions_dir)
    monkeypatch.setattr(settings, "chat_default_model", "grok-4.5")
    monkeypatch.setattr(settings, "chat_permission_mode", "bypassPermissions")
    monkeypatch.setattr(settings, "anthropic_base_url", "http://127.0.0.1:8088")
    # Clear interrupt registry between tests
    agent_bridge._active_clients.clear()
    return TestClient(app)


class FakeClient:
    """Minimal async context manager that yields scripted SDK messages."""

    def __init__(self, messages: list[Any], *, options: Any = None):
        self._messages = messages
        self.options = options
        self.queries: list[str] = []
        self.interrupted = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def query(self, prompt: str, session_id: str = "default") -> None:
        self.queries.append(prompt)

    async def receive_response(self):
        for msg in self._messages:
            yield msg

    async def interrupt(self) -> None:
        self.interrupted = True


def test_build_options_permission_mode_and_resume(monkeypatch):
    monkeypatch.setattr(settings, "chat_permission_mode", "bypassPermissions")
    monkeypatch.setattr(settings, "anthropic_base_url", "http://127.0.0.1:8088")
    monkeypatch.setattr(settings, "chat_default_model", "grok-4.5")

    session = {
        "cwd": "/tmp",
        "model": "grok-4.5",
        "sdk_session_id": "resume-me",
    }
    opts = build_options(session)
    assert isinstance(opts, ClaudeAgentOptions)
    assert opts.permission_mode == "bypassPermissions"
    assert opts.model == "grok-4.5"
    assert opts.cwd == "/tmp"
    assert opts.resume == "resume-me"
    assert opts.env["ANTHROPIC_BASE_URL"] == "http://127.0.0.1:8088"


def test_build_options_omits_resume_when_null(monkeypatch):
    monkeypatch.setattr(settings, "chat_permission_mode", "bypassPermissions")
    monkeypatch.setattr(settings, "anthropic_base_url", "http://127.0.0.1:8088")
    session = {"cwd": "/tmp", "model": "grok-4.5", "sdk_session_id": None}
    opts = build_options(session)
    assert opts.resume is None


def test_turn_accumulator_assistant_message_shape():
    acc = TurnAccumulator()
    acc.add_text("Hello ")
    acc.add_text("world")
    acc.start_tool("t1", "Bash", {"command": "echo x"})
    acc.end_tool("t1", output="x\n", is_error=False)
    msg = acc.assistant_message()
    assert msg["role"] == "assistant"
    assert msg["content"] == "Hello world"
    assert msg["tools"] == [
        {
            "id": "t1",
            "name": "Bash",
            "input_summary": "echo x",
            "output_summary": "x",
            "ok": True,
        }
    ]
    assert "id" in msg
    assert "created_at" in msg


@pytest.mark.asyncio
async def test_run_agent_turn_with_fake_client(monkeypatch, tmp_path):
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    monkeypatch.setattr(settings, "sessions_dir", sessions_dir)
    monkeypatch.setattr(settings, "chat_default_model", "grok-4.5")
    monkeypatch.setattr(settings, "chat_permission_mode", "bypassPermissions")
    monkeypatch.setattr(settings, "anthropic_base_url", "http://127.0.0.1:8088")
    agent_bridge._active_clients.clear()

    cwd = tmp_path / "proj"
    cwd.mkdir()
    session = create_session(cwd=str(cwd), title="T", model="grok-4.5")
    sid = session["id"]

    scripted = [
        AssistantMessage(
            content=[
                TextBlock(text="pong"),
                ToolUseBlock(id="tu1", name="Bash", input={"command": "true"}),
            ],
            model="grok-4.5",
        ),
        UserMessage(
            content=[
                ToolResultBlock(tool_use_id="tu1", content="ok", is_error=False),
            ]
        ),
        ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="sdk-xyz",
            total_cost_usd=0.0,
            usage={"input_tokens": 1, "output_tokens": 1},
        ),
    ]
    fake = FakeClient(scripted)

    def factory(*, options=None):
        fake.options = options
        return fake

    events = []
    async for evt in run_agent_turn(sid, "Reply with exactly: pong", client_factory=factory):
        events.append(evt)

    kinds = [e.event for e in events]
    assert kinds[0] == "meta"
    assert "text_delta" in kinds
    assert "tool_start" in kinds
    assert "tool_end" in kinds
    assert kinds[-1] == "done"

    meta_data = json.loads(events[0].data)
    assert meta_data["session_id"] == sid
    assert meta_data["model"] == "grok-4.5"

    text_events = [json.loads(e.data) for e in events if e.event == "text_delta"]
    assert text_events[0]["text"] == "pong"

    done_data = json.loads(events[-1].data)
    assert done_data["sdk_session_id"] == "sdk-xyz"

    # Fake client got the query
    assert fake.queries == ["Reply with exactly: pong"]
    # Permission mode on options
    assert fake.options.permission_mode == "bypassPermissions"

    # Session persisted user + assistant, idle, sdk id
    saved = get_session(sid)
    assert saved["status"] == "idle"
    assert saved["sdk_session_id"] == "sdk-xyz"
    roles = [m["role"] for m in saved["messages"]]
    assert roles == ["user", "assistant"]
    assert saved["messages"][0]["content"] == "Reply with exactly: pong"
    assert saved["messages"][1]["content"] == "pong"
    assert saved["messages"][1]["tools"][0]["name"] == "Bash"
    assert saved["messages"][1]["tools"][0]["ok"] is True

    # Registry cleared
    assert agent_bridge.get_active_client(sid) is None


@pytest.mark.asyncio
async def test_run_agent_turn_exception_emits_error_and_idle(monkeypatch, tmp_path):
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    monkeypatch.setattr(settings, "sessions_dir", sessions_dir)
    monkeypatch.setattr(settings, "chat_default_model", "grok-4.5")
    monkeypatch.setattr(settings, "chat_permission_mode", "bypassPermissions")
    monkeypatch.setattr(settings, "anthropic_base_url", "http://127.0.0.1:8088")
    agent_bridge._active_clients.clear()

    cwd = tmp_path / "proj"
    cwd.mkdir()
    session = create_session(cwd=str(cwd))
    sid = session["id"]

    class BoomClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def query(self, prompt, session_id="default"):
            raise RuntimeError("simulated failure")

        async def receive_response(self):
            if False:
                yield None

    events = []
    async for evt in run_agent_turn(sid, "hi", client_factory=BoomClient):
        events.append(evt)

    kinds = [e.event for e in events]
    assert "meta" in kinds
    assert "error" in kinds
    assert kinds[-1] == "done"
    err = next(e for e in events if e.event == "error")
    assert "simulated failure" in json.loads(err.data)["message"]

    saved = get_session(sid)
    assert saved["status"] == "idle"
    assert saved["messages"][0]["role"] == "user"


def test_stop_returns_409_when_idle(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "w"
    cwd.mkdir()
    created = c.post("/api/sessions", headers=_auth_headers(), json={"cwd": str(cwd)})
    sid = created.json()["id"]

    r = c.post(f"/api/sessions/{sid}/stop", headers=_auth_headers())
    assert r.status_code == 409


def test_messages_and_stop_require_auth(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    assert c.post("/api/sessions/x/messages", json={"content": "hi"}).status_code == 401
    assert c.post("/api/sessions/x/stop").status_code == 401


def test_messages_404_unknown_session(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.post(
        "/api/sessions/does-not-exist/messages",
        headers=_auth_headers(),
        json={"content": "hi"},
    )
    assert r.status_code == 404


def test_map_sdk_message_without_accumulator():
    """Mapping still works when only SSE events are needed."""
    events = map_sdk_message(
        AssistantMessage(content=[TextBlock(text="x")], model="m")
    )
    assert events[0]["event"] == "text_delta"


def test_finalize_turn_persists_tools(monkeypatch, tmp_path):
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    monkeypatch.setattr(settings, "sessions_dir", sessions_dir)
    cwd = tmp_path / "p"
    cwd.mkdir()
    session = create_session(cwd=str(cwd))
    sid = session["id"]

    acc = TurnAccumulator()
    acc.add_text("done")
    acc.start_tool("id1", "Read", {"path": "a.py"})
    acc.end_tool("id1", output="print(1)", is_error=False)
    acc.sdk_session_id = "sdk-1"

    finalize_turn(sid, acc)
    saved = get_session(sid)
    assert saved["status"] == "idle"
    assert saved["sdk_session_id"] == "sdk-1"
    assert saved["messages"][-1]["tools"][0]["name"] == "Read"
