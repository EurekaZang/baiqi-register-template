"""Unit tests for manual /compact endpoint."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock
from fastapi.testclient import TestClient

from app import agent_bridge
from app.config import settings
from app.main import app
from app.sessions import create_session, get_session, save_session


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
    agent_bridge._active_clients.clear()
    return TestClient(app)


class FakeClient:
    def __init__(
        self,
        messages: list[Any],
        *,
        options: Any = None,
        context_usage: dict[str, Any] | None = None,
    ):
        self._messages = messages
        self.options = options
        self.queries: list[str] = []
        self._context_usage = context_usage

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def query(self, prompt: str, session_id: str = "default") -> None:
        self.queries.append(prompt)

    async def receive_response(self):
        for msg in self._messages:
            yield msg

    async def get_context_usage(self) -> dict[str, Any]:
        if self._context_usage is None:
            raise RuntimeError("no ctx")
        return self._context_usage


@pytest.mark.asyncio
async def test_run_compact_appends_summary_and_refreshes_usage(monkeypatch, tmp_path):
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
    session["sdk_session_id"] = "sdk-compact-1"
    session["messages"] = [
        {
            "id": "u1",
            "role": "user",
            "content": "hello",
            "created_at": "2026-07-14T00:00:00+00:00",
        },
        {
            "id": "a1",
            "role": "assistant",
            "content": "hi there",
            "created_at": "2026-07-14T00:00:01+00:00",
        },
    ]
    save_session(session)

    scripted = [
        AssistantMessage(
            content=[TextBlock(text="Compact summary of prior turns.")],
            model="grok-4.5",
        ),
        ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="sdk-compact-1",
            total_cost_usd=0.0,
            usage={"input_tokens": 10, "output_tokens": 5},
        ),
    ]
    fake = FakeClient(
        scripted,
        context_usage={
            "categories": [{"name": "Messages", "tokens": 20, "color": "#22c55e"}],
            "totalTokens": 800,
            "maxTokens": 200000,
            "rawMaxTokens": 200000,
            "percentage": 0.4,
            "model": "grok-4.5",
            "isAutoCompactEnabled": True,
        },
    )

    def factory(*, options=None):
        fake.options = options
        return fake

    updated = await agent_bridge.run_compact_session(sid, client_factory=factory)
    assert fake.queries == ["/compact"]
    assert fake.options.resume == "sdk-compact-1"
    assert updated["status"] == "idle"
    assert updated["compacted_at"]
    assert updated["context_usage"]["total_tokens"] == 800

    roles = [m["role"] for m in updated["messages"]]
    # original 2 + system boundary + assistant summary
    assert roles == ["user", "assistant", "system", "assistant"]
    assert updated["messages"][-2]["kind"] == "compact_boundary"
    assert updated["messages"][-1]["kind"] == "compact_summary"
    assert "Compact summary" in updated["messages"][-1]["content"]


def test_compact_api_requires_sdk_session(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "p"
    cwd.mkdir()
    created = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(cwd)},
    )
    sid = created.json()["id"]
    r = c.post(f"/api/sessions/{sid}/compact", headers=_auth_headers())
    assert r.status_code == 400
    assert "history" in r.json()["detail"].lower() or "compact" in r.json()["detail"].lower()


def test_compact_api_rejects_running(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "p"
    cwd.mkdir()
    created = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(cwd)},
    )
    sid = created.json()["id"]
    session = get_session(sid)
    session["sdk_session_id"] = "sdk-x"
    session["status"] = "running"
    session["messages"] = [
        {"id": "u", "role": "user", "content": "x", "created_at": "t"}
    ]
    save_session(session)
    r = c.post(f"/api/sessions/{sid}/compact", headers=_auth_headers())
    assert r.status_code == 409
