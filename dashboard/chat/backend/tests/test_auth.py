from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def test_health_no_auth():
    c = TestClient(app)
    assert c.get("/api/health").status_code == 200


def test_sessions_requires_token(monkeypatch):
    monkeypatch.setattr(settings, "chat_token", "secret-token")
    c = TestClient(app)
    assert c.get("/api/sessions").status_code == 401
    r = c.get("/api/sessions", headers={"Authorization": "Bearer secret-token"})
    assert r.status_code == 200
    assert r.json() == []


def test_sessions_accepts_chat_token_cookie(monkeypatch):
    monkeypatch.setattr(settings, "chat_token", "secret-token")
    c = TestClient(app)
    r = c.get("/api/sessions", headers={"Cookie": "chat_token=secret-token"})
    assert r.status_code == 200
    assert r.json() == []


def test_login_sets_chat_token_cookie(monkeypatch):
    monkeypatch.setattr(settings, "chat_token", "secret-token")
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"token": "secret-token"})
    assert r.status_code == 200
    set_cookie = r.headers["set-cookie"]
    assert "chat_token=secret-token" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie
    assert "Path=/chat" in set_cookie


def test_login_rejects_invalid_token(monkeypatch):
    monkeypatch.setattr(settings, "chat_token", "secret-token")
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"token": "wrong-token"})
    assert r.status_code == 401
    assert "set-cookie" not in r.headers
