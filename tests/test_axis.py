"""Test suite per engine/ingestion/ (Axis VAPIX) — Step 05."""
from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from engine.config.models import Camera
from engine.ingestion.axis_client import AxisClient, CameraOfflineError
from engine.ingestion.clip_manager import ClipManager


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def _axis_available(cfg) -> bool:
    """Controlla disponibilità camera una sola volta per sessione."""
    async def _check() -> bool:
        try:
            cam_url = os.getenv("AXIS_TEST_CAMERA_URL", "http://10.40.65.53:8095/")
            user = os.getenv("AXIS_USERNAME", cfg.axis_default_user)
            pwd = os.getenv("AXIS_PASSWORD", cfg.axis_default_pass)
            cam = Camera(
                id="probe",
                name="Probe",
                area="test",
                axis_ip=cam_url.replace("http://", "").rstrip("/"),
            )
            c = AxisClient(cam, user, pwd, timeout=5.0)
            return await c.health_check()
        except Exception:
            return False
    try:
        return asyncio.get_event_loop().run_until_complete(_check())
    except Exception:
        return False


@pytest.fixture
def axis_client(cfg, _axis_available):
    """AxisClient sulla telecamera reale — skip se non raggiungibile."""
    if not _axis_available:
        pytest.skip("Telecamera Axis non raggiungibile")
    cam_url = os.getenv("AXIS_TEST_CAMERA_URL", "http://10.40.65.53:8095/")
    user = os.getenv("AXIS_USERNAME", cfg.axis_default_user)
    pwd = os.getenv("AXIS_PASSWORD", cfg.axis_default_pass)
    fps = int(os.getenv("AXIS_DOWNLOAD_FPS", "4"))
    cam = Camera(
        id="test_cam",
        name="Test Camera",
        area="test",
        axis_ip=cam_url.replace("http://", "").rstrip("/"),
    )
    return AxisClient(cam, user, pwd, download_fps=fps)


@pytest.fixture
def clip_manager(tmp_path):
    return ClipManager(tmp_path / "clips", tmp_path / "storage", ttl_hours=24)


# ---------------------------------------------------------------------------
# Test 01 — health check camera reale
# ---------------------------------------------------------------------------

async def test_axis_health_check(axis_client) -> None:
    ok = await axis_client.health_check()
    assert ok is True


# ---------------------------------------------------------------------------
# Test 02 — list_recordings ultimi 10 minuti (può essere vuota, non deve crashare)
# ---------------------------------------------------------------------------

async def test_list_recordings(axis_client) -> None:
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=10)
    recordings = await axis_client.list_recordings(
        event_id=os.getenv("AXIS_TEST_EVENT_ID", "cabinet"),
        start_time=start,
        end_time=end,
    )
    assert isinstance(recordings, list)
    print(f"\nTrovate {len(recordings)} registrazioni (10 min)")


# ---------------------------------------------------------------------------
# Test 03 — list_recordings ultima ora, logga risultati
# ---------------------------------------------------------------------------

async def test_list_recordings_last_hour(axis_client) -> None:
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=1)
    recordings = await axis_client.list_recordings(
        event_id=os.getenv("AXIS_TEST_EVENT_ID", "cabinet"),
        start_time=start,
        end_time=end,
    )
    for r in recordings[:3]:
        print(f"\n  ID: {r.recording_id}, start: {r.start_time}")
    assert isinstance(recordings, list)


# ---------------------------------------------------------------------------
# Test 04 — download clip più recente (se disponibile)
# ---------------------------------------------------------------------------

async def test_download_latest_clip(axis_client, tmp_path) -> None:
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=2)
    recordings = await axis_client.list_recordings(
        event_id=os.getenv("AXIS_TEST_EVENT_ID", "cabinet"),
        start_time=start,
        end_time=end,
    )
    if not recordings:
        pytest.skip("Nessuna registrazione disponibile nelle ultime 2 ore")
    rec = recordings[-1]   # più vecchia — più probabile sia completa
    path = await axis_client.download_recording(rec, tmp_path)
    assert path.exists()
    assert path.stat().st_size > 0
    assert path.suffix == ".mp4"
    print(f"\nClip scaricato: {path} ({path.stat().st_size / 1024:.1f} KB)")


# ---------------------------------------------------------------------------
# Test 05 — deduplicazione: stessa recording non riscaricata
# ---------------------------------------------------------------------------

async def test_clip_deduplication(clip_manager, axis_client) -> None:
    event_id = os.getenv("AXIS_TEST_EVENT_ID", "cabinet")
    clips_1 = await clip_manager.fetch_new_clips(axis_client, event_id, lookback_sec=3600)
    clips_2 = await clip_manager.fetch_new_clips(axis_client, event_id, lookback_sec=3600)
    ids_1 = {p.stem for p in clips_1}
    ids_2 = {p.stem for p in clips_2}
    assert ids_1.isdisjoint(ids_2), f"Clip duplicati trovati: {ids_1 & ids_2}"
    print(f"\nClip prima chiamata: {len(clips_1)}, seconda: {len(clips_2)}")


# ---------------------------------------------------------------------------
# Test 06 — cleanup TTL elimina file scaduti
# ---------------------------------------------------------------------------

async def test_cleanup_expired(tmp_path) -> None:
    manager = ClipManager(tmp_path, tmp_path / "storage", ttl_hours=0)
    old_file = tmp_path / "old_clip.mp4"
    old_file.write_bytes(b"fake mp4 data")
    # Imposta mtime 2 ore fa
    past = time.time() - 7200
    os.utime(old_file, (past, past))

    count = await manager.cleanup_expired()
    assert count >= 1
    assert not old_file.exists()


# ---------------------------------------------------------------------------
# Test 07 — camera offline → CameraOfflineError
# ---------------------------------------------------------------------------

async def test_camera_offline() -> None:
    offline_cam = Camera(
        id="offline",
        name="Offline",
        area="test",
        axis_ip="192.168.255.255",
    )
    client = AxisClient(offline_cam, "admin", "admin", timeout=2.0)
    with pytest.raises(CameraOfflineError):
        await client.health_check()
