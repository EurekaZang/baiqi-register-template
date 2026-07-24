from fastapi.testclient import TestClient
from app.main import app

def test_health_service_name():
    c = TestClient(app)
    r = c.get("/api/health")
    assert r.status_code == 200
    assert r.json()["service"] == "grox-agent"
