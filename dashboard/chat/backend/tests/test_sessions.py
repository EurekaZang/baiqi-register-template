from pathlib import Path

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def _auth_headers():
    return {"Authorization": "Bearer secret-token"}


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    monkeypatch.setattr(settings, "chat_token", "secret-token")
    monkeypatch.setattr(settings, "sessions_dir", sessions_dir)
    monkeypatch.setattr(settings, "chat_default_model", "grok-4.5")
    return TestClient(app)


def test_create_requires_absolute_existing_cwd(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)

    missing = tmp_path / "does-not-exist"
    r = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(missing)},
    )
    assert r.status_code == 400

    relative = "relative/path"
    r = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": relative},
    )
    assert r.status_code == 400

    as_file = tmp_path / "not-a-dir"
    as_file.write_text("x")
    r = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(as_file)},
    )
    assert r.status_code == 400


def test_create_defaults_model_to_grok(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "project"
    cwd.mkdir()

    r = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(cwd)},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "grok-4.5"
    assert body["title"] == "New chat"
    assert body["cwd"] == str(cwd.resolve())
    assert body["status"] == "idle"
    assert body["sdk_session_id"] is None
    assert body["messages"] == []
    assert "id" in body
    assert "created_at" in body
    assert "updated_at" in body

    # file persisted
    session_file = settings.sessions_dir / f"{body['id']}.json"
    assert session_file.is_file()


def test_list_get_patch_delete(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "workspace"
    cwd.mkdir()

    created = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(cwd), "title": "First", "model": "grok-4.5"},
    )
    assert created.status_code == 200
    session = created.json()
    sid = session["id"]

    listed = c.get("/api/sessions", headers=_auth_headers())
    assert listed.status_code == 200
    items = listed.json()
    assert isinstance(items, list)
    assert len(items) == 1
    assert items[0]["id"] == sid
    assert items[0]["title"] == "First"

    got = c.get(f"/api/sessions/{sid}", headers=_auth_headers())
    assert got.status_code == 200
    assert got.json()["id"] == sid
    assert got.json()["messages"] == []

    patched = c.patch(
        f"/api/sessions/{sid}",
        headers=_auth_headers(),
        json={"title": "Renamed"},
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "Renamed"

    got2 = c.get(f"/api/sessions/{sid}", headers=_auth_headers())
    assert got2.json()["title"] == "Renamed"

    deleted = c.delete(f"/api/sessions/{sid}", headers=_auth_headers())
    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True}

    missing = c.get(f"/api/sessions/{sid}", headers=_auth_headers())
    assert missing.status_code == 404

    listed2 = c.get("/api/sessions", headers=_auth_headers())
    assert listed2.json() == []


def test_recent_cwd_updates_on_create(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    cwd1 = tmp_path / "a"
    cwd2 = tmp_path / "b"
    cwd1.mkdir()
    cwd2.mkdir()

    empty = c.get("/api/cwd/recent", headers=_auth_headers())
    assert empty.status_code == 200
    assert empty.json() == []

    r1 = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(cwd1)},
    )
    assert r1.status_code == 200

    recent1 = c.get("/api/cwd/recent", headers=_auth_headers())
    assert recent1.status_code == 200
    assert recent1.json() == [str(cwd1.resolve())]

    r2 = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(cwd2)},
    )
    assert r2.status_code == 200

    recent2 = c.get("/api/cwd/recent", headers=_auth_headers())
    assert recent2.json()[0] == str(cwd2.resolve())
    assert str(cwd1.resolve()) in recent2.json()

    # re-using cwd1 should move it to front
    r3 = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(cwd1)},
    )
    assert r3.status_code == 200
    recent3 = c.get("/api/cwd/recent", headers=_auth_headers())
    assert recent3.json()[0] == str(cwd1.resolve())


def test_patch_rejects_cwd_and_model_while_running(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    cwd = tmp_path / "run"
    cwd.mkdir()
    other = tmp_path / "other"
    other.mkdir()

    created = c.post(
        "/api/sessions",
        headers=_auth_headers(),
        json={"cwd": str(cwd)},
    )
    sid = created.json()["id"]

    # force status=running on disk via store helper path
    from app import sessions as sessions_mod

    session = sessions_mod.get_session(sid)
    session["status"] = "running"
    sessions_mod.save_session(session)

    r_cwd = c.patch(
        f"/api/sessions/{sid}",
        headers=_auth_headers(),
        json={"cwd": str(other)},
    )
    assert r_cwd.status_code == 409

    r_model = c.patch(
        f"/api/sessions/{sid}",
        headers=_auth_headers(),
        json={"model": "other-model"},
    )
    assert r_model.status_code == 409

    # title still allowed
    r_title = c.patch(
        f"/api/sessions/{sid}",
        headers=_auth_headers(),
        json={"title": "Still ok"},
    )
    assert r_title.status_code == 200
    assert r_title.json()["title"] == "Still ok"


def test_sessions_routes_require_auth(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    assert c.get("/api/sessions").status_code == 401
    assert c.post("/api/sessions", json={"cwd": str(tmp_path)}).status_code == 401
    assert c.get("/api/cwd/recent").status_code == 401
    assert c.get("/api/sessions/x").status_code == 401
    assert c.patch("/api/sessions/x", json={"title": "t"}).status_code == 401
    assert c.delete("/api/sessions/x").status_code == 401
