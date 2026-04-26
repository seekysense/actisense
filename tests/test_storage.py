"""Test suite per engine/storage/ — Step 09."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from engine.storage.clip_store import ClipStore
from engine.storage.lancedb_store import Event, LanceDBStore


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def make_event(**kwargs) -> Event:
    defaults = dict(
        event_id=str(uuid4()),
        area_id="lobby",
        signal_id="smoking",
        camera_id="cam_lobby_01",
        timestamp=datetime.now(timezone.utc),
        score=0.65,
        action="notify",
        clip_path="/tmp/test.mp4",
        embedding=[0.0] * 512,
        llm_verdict=None,
    )
    defaults.update(kwargs)
    return Event(**defaults)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def store(tmp_path):
    s = LanceDBStore(tmp_path / "lancedb")
    await s.initialize()
    return s


# ---------------------------------------------------------------------------
# Test 01 — initialize idempotente
# ---------------------------------------------------------------------------

async def test_initialize_idempotent(tmp_path) -> None:
    s = LanceDBStore(tmp_path / "lancedb")
    await s.initialize()
    await s.initialize()   # seconda chiamata non deve errare


# ---------------------------------------------------------------------------
# Test 02 — save_event e get_events roundtrip
# ---------------------------------------------------------------------------

async def test_save_and_retrieve_event(store) -> None:
    evt = make_event(area_id="lobby", signal_id="smoking", score=0.72)
    await store.save_event(evt)
    events = await store.get_events(area_id="lobby")
    assert len(events) >= 1
    assert events[0]["signal_id"] == "smoking"
    assert abs(events[0]["score"] - 0.72) < 0.01


# ---------------------------------------------------------------------------
# Test 03 — upsert_stat: stessa (area, signal, date, hour) incrementa count
# ---------------------------------------------------------------------------

async def test_upsert_stat_increments(store) -> None:
    ts = datetime(2025, 1, 15, 14, 30, tzinfo=timezone.utc)
    await store.upsert_stat("lobby", "smoking", ts, 0.6)
    await store.upsert_stat("lobby", "smoking", ts, 0.8)
    stats = await store.get_stats(area_id="lobby")
    row = next(s for s in stats if s["signal_id"] == "smoking" and s["hour_bucket"] == 14)
    assert row["count"] == 2
    assert abs(row["max_score"] - 0.8) < 0.01


# ---------------------------------------------------------------------------
# Test 04 — upsert_stat: avg_score corretto
# ---------------------------------------------------------------------------

async def test_upsert_stat_avg(store) -> None:
    ts = datetime(2025, 1, 15, 10, 0, tzinfo=timezone.utc)
    await store.upsert_stat("pool", "fire_smoke", ts, 0.6)
    await store.upsert_stat("pool", "fire_smoke", ts, 0.8)
    stats = await store.get_stats(area_id="pool")
    row = next(s for s in stats if s["signal_id"] == "fire_smoke")
    assert abs(row["avg_score"] - 0.7) < 0.01   # (0.6 + 0.8) / 2


# ---------------------------------------------------------------------------
# Test 05 — get_events con filtro since
# ---------------------------------------------------------------------------

async def test_get_events_since_filter(store) -> None:
    now = datetime.now(timezone.utc)
    evt_old = make_event(timestamp=now - timedelta(hours=2))
    evt_new = make_event(timestamp=now - timedelta(minutes=5))
    await store.save_event(evt_old)
    await store.save_event(evt_new)
    since = now - timedelta(hours=1)
    recent = await store.get_events(since=since)
    assert len(recent) >= 1
    for e in recent:
        ts = e["timestamp"]
        if not isinstance(ts, datetime):
            ts = datetime.fromisoformat(str(ts))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        assert ts > since


# ---------------------------------------------------------------------------
# Test 06 — get_events con limit
# ---------------------------------------------------------------------------

async def test_get_events_limit(store) -> None:
    for i in range(5):
        await store.save_event(make_event(signal_id=f"s{i}"))
    events = await store.get_events(limit=3)
    assert len(events) <= 3


# ---------------------------------------------------------------------------
# Test 07 — save_event con llm_verdict
# ---------------------------------------------------------------------------

async def test_save_event_with_verdict(store) -> None:
    from engine.intelligence.llm_vision_client import LLMVerdict
    verdict = LLMVerdict(
        confirmed=True,
        description="persona a terra",
        confidence=0.92,
        raw_response="",
        model_used="test",
        latency_ms=100,
    )
    evt = make_event(llm_verdict=verdict)
    await store.save_event(evt)
    events = await store.get_events()
    assert len(events) >= 1
    latest = events[-1]
    assert latest["llm_verdict_confirmed"] is True
    assert latest["llm_verdict_confidence"] > 0.9


# ---------------------------------------------------------------------------
# Test 08 — ClipStore.save sposta file in path corretto
# ---------------------------------------------------------------------------

def test_clip_store_save(tmp_path) -> None:
    temp    = tmp_path / "temp"
    storage = tmp_path / "storage"
    temp.mkdir()
    clip_store = ClipStore(storage, temp)

    clip_file = temp / "test_clip.mp4"
    clip_file.write_bytes(b"fake mp4 data")

    event_id = "evt_abc123"
    area_id  = "lobby"
    final_path = clip_store.save(clip_file, event_id, area_id)

    assert final_path.exists()
    assert area_id in str(final_path)
    assert "evt_abc123.mp4" in str(final_path)
    assert clip_file.exists()   # copiato (non spostato) — temp rimane per altri signal


# ---------------------------------------------------------------------------
# Test 09 — statistiche 24h aggregate — AC-07
# ---------------------------------------------------------------------------

async def test_stats_24h_aggregate(store) -> None:
    base = datetime(2025, 4, 23, 0, 0, tzinfo=timezone.utc)
    for hour in range(24):
        for _ in range(3):   # 3 eventi per ora
            ts = base + timedelta(hours=hour, minutes=15)
            await store.upsert_stat("lobby", "person_count_stat", ts, 0.5)

    stats = await store.get_stats(area_id="lobby", date="2025-04-23")
    hour_buckets = {s["hour_bucket"] for s in stats}
    assert len(hour_buckets) == 24
    for s in stats:
        assert s["count"] == 3


# ---------------------------------------------------------------------------
# Test 10 — ClipStore.get_path ricostruisce path senza fs access
# ---------------------------------------------------------------------------

def test_clip_store_get_path(tmp_path) -> None:
    clip_store = ClipStore(tmp_path / "storage", tmp_path / "temp")
    ts = datetime(2025, 4, 23, 10, 0, tzinfo=timezone.utc)
    path = clip_store.get_path("evt_xyz", "kitchen", ts)
    assert "kitchen" in str(path)
    assert "evt_xyz.mp4" in str(path)
    assert "2025-04-23" in str(path)


# ---------------------------------------------------------------------------
# Test 11 — ClipStore.cleanup_temp rimuove file esistente
# ---------------------------------------------------------------------------

def test_clip_store_cleanup_temp(tmp_path) -> None:
    temp = tmp_path / "temp"
    temp.mkdir()
    clip_store = ClipStore(tmp_path / "storage", temp)
    f = temp / "to_delete.mp4"
    f.write_bytes(b"data")
    clip_store.cleanup_temp(f)
    assert not f.exists()


# ---------------------------------------------------------------------------
# Test 12 — ClipStore.cleanup_temp su file inesistente non crasha
# ---------------------------------------------------------------------------

def test_clip_store_cleanup_nonexistent(tmp_path) -> None:
    clip_store = ClipStore(tmp_path / "storage", tmp_path / "temp")
    clip_store.cleanup_temp(tmp_path / "does_not_exist.mp4")   # no exception


# ---------------------------------------------------------------------------
# Test 13 — get_events filtro per signal_id
# ---------------------------------------------------------------------------

async def test_get_events_filter_signal(store) -> None:
    await store.save_event(make_event(signal_id="fire_smoke", area_id="kitchen"))
    await store.save_event(make_event(signal_id="smoking",    area_id="kitchen"))
    events = await store.get_events(area_id="kitchen", signal_id="fire_smoke")
    assert all(e["signal_id"] == "fire_smoke" for e in events)
    assert len(events) >= 1
