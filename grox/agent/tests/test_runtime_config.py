from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app import runtime_config
from app.config import settings
from app.main import app


def _auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer secret-token"}


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    monkeypatch.setattr(settings, "chat_token", "secret-token")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "anthropic_base_url", "https://default.example")
    monkeypatch.setattr(settings, "chat_model_router_url", "https://default.example")
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    monkeypatch.setattr(settings, "chat_default_model", "grok-4.5")
    return TestClient(app)


def test_runtime_config_requires_auth(tmp_path, monkeypatch):
    c = _client(monkeypatch, tmp_path)
    assert c.get("/api/runtime-config").status_code == 401
    assert c.put("/api/runtime-config", json={"base_url": "https://x"}).status_code == 401


def test_get_runtime_config_defaults(tmp_path, monkeypatch):
    c = _client(monkeypatch, tmp_path)
    r = c.get("/api/runtime-config", headers=_auth_headers())
    assert r.status_code == 200
    body = r.json()
    assert body["base_url"] == "https://default.example"
    assert body["api_key_set"] is False
    assert body["default_model"] == "grok-4.5"
    assert "api_key" not in body


def test_put_runtime_config(tmp_path, monkeypatch):
    c = _client(monkeypatch, tmp_path)
    r = c.put(
        "/api/runtime-config",
        headers=_auth_headers(),
        json={
            "base_url": "https://kaggleyes.top/grokapi/",
            "api_key": "sk-test-secret",
            "default_model": "grok-4.5",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["base_url"] == "https://kaggleyes.top/grokapi"
    assert body["api_key_set"] is True
    assert body["default_model"] == "grok-4.5"
    assert "api_key" not in body

    # Live settings mutated for agent_bridge / models_api
    assert settings.anthropic_base_url == "https://kaggleyes.top/grokapi"
    assert settings.chat_model_router_url == "https://kaggleyes.top/grokapi"
    assert settings.anthropic_api_key == "sk-test-secret"
    assert settings.chat_default_model == "grok-4.5"

    # Persisted under data_dir/runtime.json
    path = tmp_path / "runtime.json"
    assert path.is_file()
    disk = json.loads(path.read_text(encoding="utf-8"))
    assert disk["base_url"] == "https://kaggleyes.top/grokapi"
    assert disk["api_key"] == "sk-test-secret"
    assert disk["default_model"] == "grok-4.5"

    # GET reflects saved values
    g = c.get("/api/runtime-config", headers=_auth_headers())
    assert g.status_code == 200
    assert g.json()["api_key_set"] is True
    assert g.json()["base_url"] == "https://kaggleyes.top/grokapi"


def test_put_partial_keeps_existing(tmp_path, monkeypatch):
    c = _client(monkeypatch, tmp_path)
    c.put(
        "/api/runtime-config",
        headers=_auth_headers(),
        json={"base_url": "https://a.example", "api_key": "k1"},
    )
    r = c.put(
        "/api/runtime-config",
        headers=_auth_headers(),
        json={"default_model": "other-model"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["base_url"] == "https://a.example"
    assert body["api_key_set"] is True
    assert body["default_model"] == "other-model"
    assert settings.anthropic_api_key == "k1"


def test_bootstrap_from_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "anthropic_base_url", "https://default.example")
    monkeypatch.setattr(settings, "chat_model_router_url", "https://default.example")
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    monkeypatch.setattr(settings, "chat_default_model", "grok-4.5")

    (tmp_path / "runtime.json").write_text(
        json.dumps(
            {
                "base_url": "https://boot.example",
                "api_key": "boot-key",
                "default_model": "boot-model",
            }
        ),
        encoding="utf-8",
    )
    runtime_config.bootstrap_from_disk()
    assert settings.anthropic_base_url == "https://boot.example"
    assert settings.chat_model_router_url == "https://boot.example"
    assert settings.anthropic_api_key == "boot-key"
    assert settings.chat_default_model == "boot-model"
