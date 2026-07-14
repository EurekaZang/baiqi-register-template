"""Tests for Composer Image mode → grok2api lite generation."""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

# Minimal JPEG header + padding so file looks real enough for content-type checks.
_FAKE_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9"
_FAKE_B64 = base64.b64encode(_FAKE_JPEG).decode("ascii")


def _auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer secret-token"}


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    gen_dir = tmp_path / "generated-images"
    gen_dir.mkdir()
    monkeypatch.setattr(settings, "chat_token", "secret-token")
    monkeypatch.setattr(settings, "sessions_dir", sessions_dir)
    monkeypatch.setattr(settings, "chat_generated_images_dir", gen_dir)
    monkeypatch.setattr(settings, "chat_default_model", "grok-4.5")
    monkeypatch.setattr(settings, "chat_grok2api_url", "http://127.0.0.1:8000")
    monkeypatch.setattr(settings, "chat_image_model", "grok-imagine-image-lite")
    monkeypatch.setattr(settings, "chat_grok2api_api_key", "")
    monkeypatch.setattr(settings, "chat_image_timeout_sec", 30.0)
    monkeypatch.setattr(settings, "chat_image_n", 1)
    monkeypatch.setattr(settings, "chat_root_path", "/chat")
    return TestClient(app)


def _make_session(c: TestClient, cwd: Path) -> str:
    r = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(cwd)},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_image_gen_requires_auth(monkeypatch, tmp_path: Path) -> None:
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "proj"
    cwd.mkdir()
    sid = _make_session(c, cwd)

    r = c.post(f"/api/sessions/{sid}/images", json={"prompt": "a cat"})
    assert r.status_code == 401


def test_image_gen_empty_prompt_400(monkeypatch, tmp_path: Path) -> None:
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "proj"
    cwd.mkdir()
    sid = _make_session(c, cwd)

    r = c.post(
        f"/api/sessions/{sid}/images",
        headers=_auth_headers(),
        json={"prompt": "   "},
    )
    assert r.status_code == 400
    assert "prompt" in r.json()["detail"].lower()


def test_image_gen_running_session_409(monkeypatch, tmp_path: Path) -> None:
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "proj"
    cwd.mkdir()
    sid = _make_session(c, cwd)

    from app.sessions import get_session, save_session

    session = get_session(sid)
    session["status"] = "running"
    save_session(session)

    r = c.post(
        f"/api/sessions/{sid}/images",
        headers=_auth_headers(),
        json={"prompt": "a red apple"},
    )
    assert r.status_code == 409


def test_image_gen_success_persists_local_url(monkeypatch, tmp_path: Path) -> None:
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "proj"
    cwd.mkdir()
    sid = _make_session(c, cwd)

    async def fake_post(url: str, **kwargs: Any) -> httpx.Response:
        assert url.rstrip("/").endswith("/v1/images/generations")
        body = kwargs.get("json") or {}
        assert body["model"] == "grok-imagine-image-lite"
        assert body["prompt"] == "a yellow banana on white background"
        assert body["n"] == 1
        assert body.get("response_format") == "b64_json"
        req = httpx.Request("POST", url)
        return httpx.Response(
            200,
            json={"created": 1, "data": [{"b64_json": _FAKE_B64}]},
            request=req,
        )

    with patch("app.image_gen.httpx.AsyncClient") as client_cls:
        instance = AsyncMock()
        instance.__aenter__.return_value = instance
        instance.__aexit__.return_value = None
        instance.post = fake_post
        client_cls.return_value = instance

        r = c.post(
            f"/api/sessions/{sid}/images",
            headers=_auth_headers(),
            json={"prompt": "a yellow banana on white background"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_message"]["role"] == "user"
    assert body["user_message"]["content"] == "a yellow banana on white background"
    assert body["user_message"]["meta"]["kind"] == "image_prompt"

    assert body["assistant_message"]["role"] == "assistant"
    content = body["assistant_message"]["content"]
    assert "![image](" in content
    assert "assets.grok.com" not in content
    assert f"/chat/api/sessions/{sid}/generated/" in content
    assert body["assistant_message"]["meta"]["kind"] == "image"
    assert body["assistant_message"]["meta"]["model"] == "grok-imagine-image-lite"
    urls = body["assistant_message"]["meta"]["urls"]
    assert len(urls) == 1
    local_url = urls[0]
    assert local_url.startswith(f"/chat/api/sessions/{sid}/generated/")

    # File on disk
    file_id = local_url.rsplit("/", 1)[-1]
    disk = Path(settings.chat_generated_images_dir) / sid / file_id
    assert disk.is_file()
    assert disk.read_bytes()[:3] == b"\xff\xd8\xff"

    # Authenticated GET serves the image
    gr = c.get(local_url.replace("/chat", "", 1), headers=_auth_headers())
    # route is /api/... without /chat prefix on the app itself
    gr = c.get(f"/api/sessions/{sid}/generated/{file_id}", headers=_auth_headers())
    assert gr.status_code == 200
    assert gr.content[:3] == b"\xff\xd8\xff"
    assert "image" in (gr.headers.get("content-type") or "")

    # Unauthenticated GET blocked
    gr2 = c.get(f"/api/sessions/{sid}/generated/{file_id}")
    assert gr2.status_code == 401

    from app.sessions import get_session

    session = get_session(sid)
    assert len(session["messages"]) == 2
    assert session["title"] != "New chat"
    assert "banana" in session["title"].lower() or "yellow" in session["title"].lower()


def test_image_gen_upstream_error_502(monkeypatch, tmp_path: Path) -> None:
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "proj"
    cwd.mkdir()
    sid = _make_session(c, cwd)

    async def fake_post(url: str, **kwargs: Any) -> httpx.Response:
        req = httpx.Request("POST", url)
        return httpx.Response(500, json={"error": "boom"}, request=req)

    with patch("app.image_gen.httpx.AsyncClient") as client_cls:
        instance = AsyncMock()
        instance.__aenter__.return_value = instance
        instance.__aexit__.return_value = None
        instance.post = fake_post
        client_cls.return_value = instance

        r = c.post(
            f"/api/sessions/{sid}/images",
            headers=_auth_headers(),
            json={"prompt": "a cat"},
        )

    assert r.status_code == 502
    from app.sessions import get_session

    session = get_session(sid)
    assert session["messages"] == []
