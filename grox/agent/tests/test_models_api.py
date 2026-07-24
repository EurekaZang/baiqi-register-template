from __future__ import annotations

import time
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app import models_api


def _auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer secret-token"}


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "chat_token", "secret-token")
    monkeypatch.setattr(settings, "chat_model_router_url", "http://router.test")
    monkeypatch.setattr(settings, "chat_default_model", "grok-4.5")
    monkeypatch.setattr(settings, "models_cache_ttl_sec", 45.0)
    models_api.clear_models_cache()
    return TestClient(app)


class _FakeResponse:
    def __init__(self, payload: Any, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("GET", "http://router.test/v1/models")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("error", request=request, response=response)

    def json(self) -> Any:
        return self._payload


class _FakeAsyncClient:
    """Minimal stand-in for httpx.AsyncClient used by models_api."""

    next_response: _FakeResponse | Exception | None = None
    calls: list[str] = []
    last_headers: dict[str, str] | None = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str, **kwargs):
        type(self).calls.append(url)
        headers = kwargs.get("headers")
        if headers is None:
            type(self).last_headers = None
        else:
            type(self).last_headers = dict(headers)
        result = type(self).next_response
        if isinstance(result, Exception):
            raise result
        if result is None:
            raise RuntimeError("no fake response configured")
        return result


@pytest.fixture(autouse=True)
def _reset_fake_client():
    _FakeAsyncClient.next_response = None
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.last_headers = None
    models_api.clear_models_cache()
    yield
    models_api.clear_models_cache()
    _FakeAsyncClient.next_response = None
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.last_headers = None


def test_models_requires_auth(monkeypatch):
    c = _client(monkeypatch)
    assert c.get("/api/models").status_code == 401


def test_models_sends_bearer_when_api_key_set(monkeypatch):
    c = _client(monkeypatch)
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test-key")
    monkeypatch.setattr(models_api.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.next_response = _FakeResponse(
        {"data": [{"id": "grok-4.5", "display_name": "Grok"}]}
    )

    r = c.get("/api/models", headers=_auth_headers())
    assert r.status_code == 200
    assert _FakeAsyncClient.last_headers is not None
    assert _FakeAsyncClient.last_headers.get("Authorization") == "Bearer sk-test-key"
    assert _FakeAsyncClient.last_headers.get("x-api-key") == "sk-test-key"


def test_models_omits_auth_headers_without_api_key(monkeypatch):
    c = _client(monkeypatch)
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    monkeypatch.setattr(models_api.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.next_response = _FakeResponse(
        {"data": [{"id": "grok-4.5"}]}
    )

    r = c.get("/api/models", headers=_auth_headers())
    assert r.status_code == 200
    assert _FakeAsyncClient.last_headers is None


def test_models_normalizes_and_sets_default(monkeypatch):
    c = _client(monkeypatch)
    monkeypatch.setattr(models_api.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.next_response = _FakeResponse(
        {
            "object": "list",
            "data": [
                {"id": "claude-sonnet-5", "display_name": "Claude Sonnet 5"},
                {"id": "grok-4.5", "object": "model", "owned_by": "xai"},
                {"id": "no-display"},
                {"display_name": "missing-id"},
                "not-a-dict",
            ],
        }
    )

    r = c.get("/api/models", headers=_auth_headers())
    assert r.status_code == 200
    body = r.json()
    assert body["object"] == "list"
    assert body["default"] == "grok-4.5"
    assert body.get("stale") is False
    ids = [m["id"] for m in body["data"]]
    assert ids == ["claude-sonnet-5", "grok-4.5", "no-display"]
    claude = next(m for m in body["data"] if m["id"] == "claude-sonnet-5")
    assert claude["display_name"] == "Claude Sonnet 5"
    grok = next(m for m in body["data"] if m["id"] == "grok-4.5")
    assert grok["display_name"] == "grok-4.5"
    no_display = next(m for m in body["data"] if m["id"] == "no-display")
    assert no_display["display_name"] == "no-display"
    assert _FakeAsyncClient.calls == ["http://router.test/v1/models"]


def test_models_uses_cache_within_ttl(monkeypatch):
    c = _client(monkeypatch)
    monkeypatch.setattr(models_api.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.next_response = _FakeResponse(
        {"data": [{"id": "m1", "display_name": "Model 1"}]}
    )

    r1 = c.get("/api/models", headers=_auth_headers())
    assert r1.status_code == 200
    assert len(_FakeAsyncClient.calls) == 1

    _FakeAsyncClient.next_response = _FakeResponse(
        {"data": [{"id": "m2", "display_name": "Model 2"}]}
    )
    r2 = c.get("/api/models", headers=_auth_headers())
    assert r2.status_code == 200
    assert r2.json()["data"][0]["id"] == "m1"
    assert len(_FakeAsyncClient.calls) == 1  # still cached


def test_models_refetches_after_ttl(monkeypatch):
    c = _client(monkeypatch)
    monkeypatch.setattr(settings, "models_cache_ttl_sec", 0.05)
    monkeypatch.setattr(models_api.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.next_response = _FakeResponse(
        {"data": [{"id": "m1", "display_name": "Model 1"}]}
    )

    r1 = c.get("/api/models", headers=_auth_headers())
    assert r1.status_code == 200
    assert r1.json()["data"][0]["id"] == "m1"

    time.sleep(0.06)
    _FakeAsyncClient.next_response = _FakeResponse(
        {"data": [{"id": "m2", "display_name": "Model 2"}]}
    )
    r2 = c.get("/api/models", headers=_auth_headers())
    assert r2.status_code == 200
    assert r2.json()["data"][0]["id"] == "m2"
    assert len(_FakeAsyncClient.calls) == 2


def test_models_returns_stale_cache_on_upstream_failure(monkeypatch):
    c = _client(monkeypatch)
    monkeypatch.setattr(models_api.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.next_response = _FakeResponse(
        {"data": [{"id": "cached", "display_name": "Cached"}]}
    )
    r1 = c.get("/api/models", headers=_auth_headers())
    assert r1.status_code == 200
    assert r1.json().get("stale") is False

    # expire cache
    monkeypatch.setattr(settings, "models_cache_ttl_sec", 0.0)
    _FakeAsyncClient.next_response = httpx.ConnectError("boom")
    r2 = c.get("/api/models", headers=_auth_headers())
    assert r2.status_code == 200
    body = r2.json()
    assert body["data"][0]["id"] == "cached"
    assert body["stale"] is True
    assert body["default"] == "grok-4.5"
    assert r2.headers.get("x-models-stale") == "true"


def test_models_503_when_no_cache_and_upstream_fails(monkeypatch):
    c = _client(monkeypatch)
    monkeypatch.setattr(models_api.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.next_response = httpx.ConnectError("down")

    r = c.get("/api/models", headers=_auth_headers())
    assert r.status_code == 503
    assert "model" in r.json()["detail"].lower() or "unavailable" in r.json()["detail"].lower()


def test_models_503_on_http_error_without_cache(monkeypatch):
    c = _client(monkeypatch)
    monkeypatch.setattr(models_api.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.next_response = _FakeResponse({"error": "nope"}, status_code=502)

    r = c.get("/api/models", headers=_auth_headers())
    assert r.status_code == 503
