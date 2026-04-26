"""API tests — FastAPI REST + WebSocket (Step 12)."""
import os
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("API_USERNAME", "testuser")
os.environ.setdefault("API_PASSWORD", "testpass")
os.environ.setdefault("JWT_SECRET", "test-secret")

from api.main import app  # noqa: E402

client = TestClient(app)


def _get_token() -> str:
    res = client.post(
        "/api/auth/login",
        data={"username": "testuser", "password": "testpass"},
    )
    assert res.status_code == 200
    return res.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Auth ──────────────────────────────────────────────────────────────────────

def test_login_success():
    res = client.post(
        "/api/auth/login",
        data={"username": "testuser", "password": "testpass"},
    )
    assert res.status_code == 200
    assert "access_token" in res.json()
    assert res.json()["token_type"] == "bearer"


def test_login_wrong_password():
    res = client.post(
        "/api/auth/login",
        data={"username": "testuser", "password": "wrong"},
    )
    assert res.status_code == 401


def test_protected_route_requires_auth():
    res = client.get("/api/alerts")
    assert res.status_code == 401


# ── Health ────────────────────────────────────────────────────────────────────

def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


# ── Alerts ────────────────────────────────────────────────────────────────────

def test_receive_alert():
    payload = {
        "event_id": "test-001",
        "area_id": "lobby",
        "signal_id": "smoking",
        "score": 0.72,
        "action": "notify",
        "priority": 2,
        "timestamp": "2025-04-23T14:30:00Z",
    }
    res = client.post("/api/internal/alert", json=payload)
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_get_alerts_after_post():
    token = _get_token()
    payload = {
        "event_id": "test-002",
        "area_id": "lobby",
        "signal_id": "smoking",
        "score": 0.7,
        "action": "notify",
        "priority": 2,
        "timestamp": "2025-04-23T14:00:00Z",
    }
    client.post("/api/internal/alert", json=payload)
    res = client.get("/api/alerts?limit=5", headers=_auth(token))
    assert res.status_code == 200
    assert isinstance(res.json(), list)
    assert any(a["event_id"] == "test-002" for a in res.json())


def test_receive_alert_missing_field():
    res = client.post("/api/internal/alert", json={"signal_id": "smoking"})
    assert res.status_code == 422


# ── Events / Stats ────────────────────────────────────────────────────────────

def test_get_events_no_db(monkeypatch, tmp_path):
    token = _get_token()
    monkeypatch.setenv("LANCEDB_PATH", str(tmp_path / "nonexistent"))
    res = client.get("/api/events", headers=_auth(token))
    assert res.status_code == 200
    assert res.json()["count"] == 0


def test_get_stats_no_db(monkeypatch, tmp_path):
    token = _get_token()
    monkeypatch.setenv("LANCEDB_PATH", str(tmp_path / "nonexistent"))
    res = client.get("/api/stats", headers=_auth(token))
    assert res.status_code == 200
    assert res.json()["count"] == 0


def test_get_events_filtered(monkeypatch, tmp_path):
    token = _get_token()
    monkeypatch.setenv("LANCEDB_PATH", str(tmp_path / "empty"))
    res = client.get("/api/events?area_id=lobby&limit=10", headers=_auth(token))
    assert res.status_code == 200


# ── Config ────────────────────────────────────────────────────────────────────

def test_get_config():
    token = _get_token()
    res = client.get("/api/config", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()
    assert "site" in data
    assert "areas" in data
    assert "signals" in data
    config_str = str(data)
    assert "axis_pass" not in config_str
    assert "password" not in config_str.lower()


# ── WebSocket ─────────────────────────────────────────────────────────────────

def test_websocket_alert():
    with client.websocket_connect("/api/ws") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "connected"

        client.post(
            "/api/internal/alert",
            json={
                "event_id": "ws-test-001",
                "area_id": "lobby",
                "signal_id": "person_on_ground",
                "score": 0.85,
                "action": "alarm",
                "priority": 1,
                "timestamp": "2025-04-23T14:30:00Z",
            },
        )

        for _ in range(20):
            msg = ws.receive_json()
            if msg.get("type") == "alert" and msg["data"]["event_id"] == "ws-test-001":
                break
        else:
            pytest.fail("Alert not received on WebSocket")
