"""Tests for Config CRUD API (Step 15 Feature B + Step 16 typed schemas)."""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("API_USERNAME", "testuser")
os.environ.setdefault("API_PASSWORD", "testpass")
os.environ.setdefault("JWT_SECRET", "test-secret")

from api.main import app  # noqa: E402

TEST_API_KEY = "test-api-key-12345"
AUTH_HEADERS = {"Authorization": f"Bearer {TEST_API_KEY}"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def patch_api_key(monkeypatch):
    """Set CONFIG_API_KEY at module level (already imported) so auth works."""
    monkeypatch.setattr("api.deps.CONFIG_API_KEY", TEST_API_KEY)


@pytest.fixture()
def tmp_config(tmp_path, monkeypatch):
    """
    Create a minimal config tree in tmp_path and point SITE_CONFIG_PATH to it.
    Signal library has 3 signals; lobby area has 2 of them assigned.
    """
    config_dir = tmp_path / "config"
    signals_dir = config_dir / "signals"
    cameras_dir = config_dir / "cameras"
    signals_dir.mkdir(parents=True)
    cameras_dir.mkdir(parents=True)

    (signals_dir / "hotel.yaml").write_text(
        "signals:\n"
        "  - id: person_on_ground\n"
        "    name: Man Down\n"
        "    text: person lying flat on the floor\n"
        "    priority: 1\n"
        "    default_threshold: 0.44\n"
        "    default_action: alarm\n"
        "    escalation_llm: true\n"
        "  - id: smoking\n"
        "    name: Smoking Detected\n"
        "    text: a person holding a cigarette\n"
        "    priority: 2\n"
        "    default_threshold: 0.43\n"
        "    default_action: notify\n"
        "    escalation_llm: true\n"
        "  - id: fire_smoke\n"
        "    name: Fire or Smoke\n"
        "    text: visible smoke or flames in the area\n"
        "    priority: 1\n"
        "    default_threshold: 0.45\n"
        "    default_action: alarm\n"
        "    escalation_llm: true\n",
        encoding="utf-8",
    )

    (signals_dir / "custom.yaml").write_text(
        "signals: []\n",
        encoding="utf-8",
    )

    (cameras_dir / "cam_test_01.yaml").write_text(
        "id: cam_test_01\n"
        "name: Test Camera 01\n"
        "area: lobby\n"
        "axis_ip: '192.168.1.10'\n"
        "axis_user: admin\n"
        "axis_pass: secret\n",
        encoding="utf-8",
    )

    (config_dir / "site.yaml").write_text(
        "site:\n"
        "  id: test_site\n"
        "  name: Test Hotel\n"
        "  type: hotel\n"
        "  signal_library:\n"
        "    - config/signals/hotel.yaml\n"
        "    - config/signals/custom.yaml\n"
        "  alert_cooldown_sec: 300\n"
        "areas:\n"
        "  - id: lobby\n"
        "    name: Lobby\n"
        "    type: indoor_public\n"
        "    alert_cooldown_sec: 180\n"
        "    cameras: [cam_test_01]\n"
        "    signals:\n"
        "      - id: person_on_ground\n"
        "      - id: smoking\n",
        encoding="utf-8",
    )

    site_path = str(config_dir / "site.yaml")
    monkeypatch.setenv("SITE_CONFIG_PATH", site_path)

    yield config_dir


client = TestClient(app)


# ---------------------------------------------------------------------------
# Auth tests
# ---------------------------------------------------------------------------

def test_config_api_key_accepted(tmp_config):
    res = client.get("/api/config/signals", headers=AUTH_HEADERS)
    assert res.status_code == 200


def test_no_token_returns_401(tmp_config):
    res = client.get("/api/config/signals")
    assert res.status_code == 401


def test_wrong_api_key_returns_401(tmp_config):
    res = client.get("/api/config/signals",
                     headers={"Authorization": "Bearer wrong-key"})
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/config — legacy summary endpoint (JWT / api-key)
# ---------------------------------------------------------------------------

def test_get_config_summary(tmp_config):
    res = client.get("/api/config", headers=AUTH_HEADERS)
    assert res.status_code == 200
    data = res.json()
    assert "site" in data
    assert "areas" in data
    assert "signals" in data
    assert "webhook_url" in data["site"]


def test_get_config_no_credentials_leaked(tmp_config):
    res = client.get("/api/config", headers=AUTH_HEADERS)
    text = str(res.json())
    assert "axis_pass" not in text
    assert "secret" not in text


# ---------------------------------------------------------------------------
# Site CRUD
# ---------------------------------------------------------------------------

def test_get_site(tmp_config):
    res = client.get("/api/config/site", headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert res.json()["id"] == "test_site"
    assert res.json()["name"] == "Test Hotel"


def test_patch_site_name(tmp_config):
    res = client.patch("/api/config/site",
                       json={"name": "Updated Hotel"},
                       headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert res.json()["name"] == "Updated Hotel"


def test_patch_site_webhook_url(tmp_config):
    res = client.patch("/api/config/site",
                       json={"webhook_url": "http://new-backend/alert"},
                       headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert res.json()["webhook_url"] == "http://new-backend/alert"

    # Verify persisted
    res2 = client.get("/api/config/site", headers=AUTH_HEADERS)
    assert res2.json()["webhook_url"] == "http://new-backend/alert"


def test_patch_site_partial_does_not_reset_other_fields(tmp_config):
    client.patch("/api/config/site", json={"name": "First Name"}, headers=AUTH_HEADERS)
    client.patch("/api/config/site", json={"alert_cooldown_sec": 600}, headers=AUTH_HEADERS)
    res = client.get("/api/config/site", headers=AUTH_HEADERS)
    assert res.json()["name"] == "First Name"


# ---------------------------------------------------------------------------
# Signals CRUD
# ---------------------------------------------------------------------------

def test_list_signals(tmp_config):
    res = client.get("/api/config/signals", headers=AUTH_HEADERS)
    assert res.status_code == 200
    signals = res.json()
    assert isinstance(signals, list)
    ids = [s["id"] for s in signals]
    assert "person_on_ground" in ids
    assert "smoking" in ids
    assert "fire_smoke" in ids


def test_get_signal(tmp_config):
    res = client.get("/api/config/signals/smoking", headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert res.json()["id"] == "smoking"


def test_get_signal_not_found(tmp_config):
    res = client.get("/api/config/signals/nonexistent_xyz", headers=AUTH_HEADERS)
    assert res.status_code == 404


def test_patch_signal(tmp_config):
    res = client.patch(
        "/api/config/signals/smoking",
        json={"name": "Smoking Updated", "default_threshold": 0.50},
        headers=AUTH_HEADERS,
    )
    assert res.status_code == 200
    assert res.json()["name"] == "Smoking Updated"
    assert res.json()["default_threshold"] == 0.50
    assert res.json()["id"] == "smoking"


def test_patch_signal_not_found(tmp_config):
    res = client.patch(
        "/api/config/signals/nonexistent_xyz",
        json={"text": "x"},
        headers=AUTH_HEADERS,
    )
    assert res.status_code == 404


def test_create_and_delete_signal(tmp_config):
    new_sig = {
        "id": "test_signal_999",
        "name": "Test Signal",
        "text": "a test event",
        "priority": 3,
        "default_threshold": 0.50,
        "default_action": "statistic",
        "escalation_llm": False,
    }
    # Create
    res = client.post("/api/config/signals", json=new_sig, headers=AUTH_HEADERS)
    assert res.status_code == 201
    assert res.json()["id"] == "test_signal_999"

    # Verify it appears in list
    res2 = client.get("/api/config/signals", headers=AUTH_HEADERS)
    assert any(s["id"] == "test_signal_999" for s in res2.json())

    # Delete
    res3 = client.delete("/api/config/signals/test_signal_999", headers=AUTH_HEADERS)
    assert res3.status_code == 204

    # Verify gone
    res4 = client.get("/api/config/signals/test_signal_999", headers=AUTH_HEADERS)
    assert res4.status_code == 404


def test_create_signal_duplicate_rejected(tmp_config):
    res = client.post("/api/config/signals",
                      json={"id": "person_on_ground", "text": "dup"},
                      headers=AUTH_HEADERS)
    assert res.status_code == 409


def test_create_signal_missing_id(tmp_config):
    res = client.post("/api/config/signals",
                      json={"text": "no id here"},
                      headers=AUTH_HEADERS)
    assert res.status_code == 422


# ---------------------------------------------------------------------------
# Areas CRUD
# ---------------------------------------------------------------------------

def test_list_areas(tmp_config):
    res = client.get("/api/config/areas", headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert isinstance(res.json(), list)
    assert any(a["id"] == "lobby" for a in res.json())


def test_get_area(tmp_config):
    res = client.get("/api/config/areas/lobby", headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert res.json()["id"] == "lobby"


def test_get_area_not_found(tmp_config):
    res = client.get("/api/config/areas/nonexistent_xyz", headers=AUTH_HEADERS)
    assert res.status_code == 404


def test_patch_area_webhook_url(tmp_config):
    res = client.patch("/api/config/areas/lobby",
                       json={"webhook_url": "http://area-specific/alert"},
                       headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert res.json()["webhook_url"] == "http://area-specific/alert"

    res2 = client.get("/api/config/areas/lobby", headers=AUTH_HEADERS)
    assert res2.json()["webhook_url"] == "http://area-specific/alert"


def test_list_area_signals(tmp_config):
    res = client.get("/api/config/areas/lobby/signals", headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert isinstance(res.json(), list)
    ids = [s["id"] for s in res.json()]
    assert "person_on_ground" in ids
    assert "smoking" in ids


def test_add_area_signal(tmp_config):
    # fire_smoke is in the library but not yet in the area
    new_sig = {"id": "fire_smoke", "threshold_override": 0.40}
    res = client.post("/api/config/areas/lobby/signals",
                      json=new_sig, headers=AUTH_HEADERS)
    assert res.status_code == 201
    assert res.json()["id"] == "fire_smoke"


def test_add_area_signal_duplicate_rejected(tmp_config):
    # person_on_ground is already in lobby
    res = client.post("/api/config/areas/lobby/signals",
                      json={"id": "person_on_ground"},
                      headers=AUTH_HEADERS)
    assert res.status_code == 409


def test_patch_area_signal(tmp_config):
    res = client.patch("/api/config/areas/lobby/signals/smoking",
                       json={"threshold_override": 0.55, "action_override": "alarm"},
                       headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert res.json()["threshold_override"] == 0.55
    assert res.json()["action_override"] == "alarm"
    assert res.json()["id"] == "smoking"


def test_remove_area_signal(tmp_config):
    # Add fire_smoke first
    client.post("/api/config/areas/lobby/signals",
                json={"id": "fire_smoke"}, headers=AUTH_HEADERS)

    res = client.delete("/api/config/areas/lobby/signals/fire_smoke",
                        headers=AUTH_HEADERS)
    assert res.status_code == 204

    # Verify removed
    area = client.get("/api/config/areas/lobby", headers=AUTH_HEADERS).json()
    signal_ids = [s["id"] for s in area.get("signals", []) if isinstance(s, dict)]
    assert "fire_smoke" not in signal_ids


# ---------------------------------------------------------------------------
# Cameras
# ---------------------------------------------------------------------------

def test_list_cameras(tmp_config):
    res = client.get("/api/config/cameras", headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert isinstance(res.json(), list)
    assert any(c.get("id") == "cam_test_01" for c in res.json())


def test_get_camera(tmp_config):
    res = client.get("/api/config/cameras/cam_test_01", headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert res.json()["id"] == "cam_test_01"


def test_get_camera_hides_axis_pass(tmp_config):
    res = client.get("/api/config/cameras/cam_test_01", headers=AUTH_HEADERS)
    assert "axis_pass" not in res.json()
    assert "secret" not in str(res.json())


def test_get_camera_not_found(tmp_config):
    res = client.get("/api/config/cameras/nonexistent_cam", headers=AUTH_HEADERS)
    assert res.status_code == 404


def test_validate_camera_id_blocks_traversal():
    """validate_camera_id() must reject IDs with path traversal characters."""
    from api.services.config_writer import validate_camera_id
    import pytest as _pytest
    for bad in ["../site", "cam/../../etc", "cam..pass", "cam id"]:
        with _pytest.raises(ValueError):
            validate_camera_id(bad)

    for good in ["cam_kitchen_01", "cam-parking-01", "CAM01"]:
        validate_camera_id(good)


def test_patch_camera(tmp_config):
    res = client.patch(
        "/api/config/cameras/cam_test_01",
        json={"name": "Updated Camera", "axis_ip": "192.168.1.20"},
        headers=AUTH_HEADERS,
    )
    assert res.status_code == 200
    assert res.json()["name"] == "Updated Camera"
    assert res.json()["axis_ip"] == "192.168.1.20"
    assert res.json()["id"] == "cam_test_01"
    assert "axis_pass" not in res.json()


def test_patch_camera_does_not_expose_axis_pass(tmp_config):
    # axis_pass is not in CameraPatch schema — it is silently ignored
    res = client.patch(
        "/api/config/cameras/cam_test_01",
        json={"name": "x"},
        headers=AUTH_HEADERS,
    )
    assert res.status_code == 200
    assert "axis_pass" not in res.json()
