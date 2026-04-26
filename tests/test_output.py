"""Test suite per engine/output/ + ActionRouter completo — Step 10."""
from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp import web

from engine.intelligence.action_router import ActionResult, ActionRouter
from engine.intelligence.signal_evaluator import ScoredSignal
from engine.output.alert_dedup import AlertDedup
from engine.output.notifier import AlertPayload, Notifier
from engine.storage.clip_store import ClipStore
from engine.storage.lancedb_store import LanceDBStore
from engine.config.models import AreaSignal, Signal
from engine.queue.priority_queue import ClipJob


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_alert_payload(**kwargs) -> AlertPayload:
    defaults = dict(
        event_id="evt_test",
        timestamp="2025-04-23T14:30:00.000Z",
        area_id="lobby",
        area_name="Lobby ingresso",
        signal_id="smoking",
        signal_text="person smoking",
        score=0.72,
        action="notify",
        priority=2,
        clip_path=None,
        llm_verdict=None,
        camera_id="cam_lobby_01",
    )
    defaults.update(kwargs)
    return AlertPayload(**defaults)


def make_clip_job(area_id: str = "lobby", clip_path: Path | None = None) -> ClipJob:
    return ClipJob(
        clip_path=clip_path or Path("clip.mp4"),
        camera_id="cam_test",
        area_id=area_id,
        recording_id="rec_test",
        enqueued_at=time.monotonic(),
        priority=2,
    )


def make_scored(signal_id="smoking", action="notify", **sig_kwargs) -> ScoredSignal:
    signal = Signal(id=signal_id, text="test signal", default_action=action, **sig_kwargs)
    as_ = AreaSignal(signal_id=signal_id)
    return ScoredSignal(
        signal_id=signal_id,
        score=0.75,
        threshold=0.52,
        action=action,
        exceeds_threshold=True,
        area_signal=as_,
        signal=signal,
    )


def make_frame_set() -> SimpleNamespace:
    return SimpleNamespace(frames_llm=["base64frame1", "base64frame2"])


# ---------------------------------------------------------------------------
# Test 01 — webhook riceve payload corretto
# ---------------------------------------------------------------------------

async def test_notifier_send(aiohttp_server) -> None:
    received: list[dict] = []

    async def handler(request: web.Request) -> web.Response:
        received.append(await request.json())
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    notifier = Notifier(f"http://localhost:{server.port}/webhook")
    payload = make_alert_payload(action="notify")
    ok = await notifier.send(payload)

    assert ok is True
    assert len(received) == 1
    assert received[0]["signal_id"] == payload.signal_id
    assert received[0]["action"] == "notify"
    assert received[0]["area_id"] == "lobby"


# ---------------------------------------------------------------------------
# Test 02 — send_priority aggiunge header X-VSA-Priority: critical
# ---------------------------------------------------------------------------

async def test_notifier_send_priority_header(aiohttp_server) -> None:
    headers_received: dict = {}

    async def handler(request: web.Request) -> web.Response:
        headers_received.update(dict(request.headers))
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    notifier = Notifier(f"http://localhost:{server.port}/webhook")
    ok = await notifier.send_priority(make_alert_payload(action="alarm"))

    assert ok is True
    assert headers_received.get("X-Vsa-Priority") == "critical"


# ---------------------------------------------------------------------------
# Test 03 — webhook non disponibile → False, no eccezione
# ---------------------------------------------------------------------------

async def test_notifier_unavailable() -> None:
    notifier = Notifier("http://localhost:19999/webhook", timeout=1.0)
    ok = await notifier.send(make_alert_payload())
    assert ok is False


# ---------------------------------------------------------------------------
# Test 04 — webhook HTTP 500 → False
# ---------------------------------------------------------------------------

async def test_notifier_server_error(aiohttp_server) -> None:
    async def handler(request: web.Request) -> web.Response:
        return web.Response(status=500)

    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    notifier = Notifier(f"http://localhost:{server.port}/webhook")
    ok = await notifier.send(make_alert_payload())
    assert ok is False


# ---------------------------------------------------------------------------
# Test 05 — ActionRouter notify: webhook chiamato + evento in LanceDB
# ---------------------------------------------------------------------------

async def test_action_router_notify(tmp_path, aiohttp_server) -> None:
    received: list[dict] = []

    async def handler(request: web.Request) -> web.Response:
        received.append(await request.json())
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    store      = LanceDBStore(tmp_path / "db")
    await store.initialize()
    clip_store = ClipStore(tmp_path / "storage", tmp_path / "temp")
    notifier   = Notifier(f"http://localhost:{server.port}/webhook")
    router     = ActionRouter(AlertDedup(), store, notifier, clip_store, llm_client=None)

    scored   = make_scored("smoking", action="notify", priority=2)
    (tmp_path / "temp").mkdir(exist_ok=True)
    clip_file = tmp_path / "temp" / "clip.mp4"
    clip_file.write_bytes(b"fake mp4")
    job      = make_clip_job(area_id="lobby", clip_path=clip_file)
    area_cfg = SimpleNamespace(id="lobby", name="Lobby ingresso", alert_cooldown_sec=300)

    results = await router.route([scored], job, None, 300, area_cfg)

    assert results[0].fired is True
    assert len(received) == 1
    assert received[0]["signal_id"] == "smoking"
    assert received[0]["area_name"] == "Lobby ingresso"

    events = await store.get_events(area_id="lobby")
    assert len(events) == 1
    assert events[0]["signal_id"] == "smoking"


# ---------------------------------------------------------------------------
# Test 06 — cooldown blocca secondo alert — AC-03
# ---------------------------------------------------------------------------

async def test_action_router_cooldown(tmp_path, aiohttp_server) -> None:
    received: list[dict] = []

    async def handler(request: web.Request) -> web.Response:
        received.append(await request.json())
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    store  = LanceDBStore(tmp_path / "db")
    await store.initialize()
    notifier = Notifier(f"http://localhost:{server.port}/webhook")
    router   = ActionRouter(
        AlertDedup(), store, notifier,
        ClipStore(tmp_path / "s", tmp_path / "t"), None,
    )

    scored = make_scored("s1", action="notify", cooldown_sec=300)
    job    = make_clip_job()
    area   = SimpleNamespace(id="a", name="A", alert_cooldown_sec=300)

    r1 = await router.route([scored], job, None, 300, area)
    r2 = await router.route([scored], job, None, 300, area)

    assert r1[0].fired is True
    assert r2[0].fired is False
    assert len(received) == 1   # secondo alert bloccato da cooldown


# ---------------------------------------------------------------------------
# Test 07 — LLM non disponibile → alert inviato comunque — PRD §8.2
# ---------------------------------------------------------------------------

async def test_action_router_llm_degraded(tmp_path, aiohttp_server) -> None:
    received: list[dict] = []

    async def handler(request: web.Request) -> web.Response:
        received.append(await request.json())
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    store        = LanceDBStore(tmp_path / "db")
    await store.initialize()
    notifier     = Notifier(f"http://localhost:{server.port}/webhook")
    failing_llm  = AsyncMock()
    failing_llm.analyze = AsyncMock(side_effect=Exception("LLM down"))

    router = ActionRouter(
        AlertDedup(), store, notifier,
        ClipStore(tmp_path / "s", tmp_path / "t"),
        failing_llm,
    )

    scored = make_scored("smoking2", action="notify", escalation_llm=True)
    job    = make_clip_job()
    area   = SimpleNamespace(id="lobby", name="Lobby", alert_cooldown_sec=300)

    results = await router.route([scored], job, make_frame_set(), 300, area)

    assert results[0].fired is True
    assert results[0].llm_escalation is False   # LLM fallito, no contributo
    assert len(received) == 1
    assert received[0].get("llm_verdict") is None


# ---------------------------------------------------------------------------
# Test 08 — ActionRouter alarm usa send_priority
# ---------------------------------------------------------------------------

async def test_action_router_alarm_uses_send_priority(tmp_path, aiohttp_server) -> None:
    headers_received: dict = {}

    async def handler(request: web.Request) -> web.Response:
        headers_received.update(dict(request.headers))
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    store  = LanceDBStore(tmp_path / "db")
    await store.initialize()
    router = ActionRouter(
        AlertDedup(), store,
        Notifier(f"http://localhost:{server.port}/webhook"),
        ClipStore(tmp_path / "s", tmp_path / "t"), None,
    )

    scored = make_scored("cabinet_opened", action="alarm")
    job    = make_clip_job()
    area   = SimpleNamespace(id="kitchen", name="Kitchen", alert_cooldown_sec=300)

    results = await router.route([scored], job, None, 300, area)

    assert results[0].fired is True
    assert headers_received.get("X-Vsa-Priority") == "critical"


# ---------------------------------------------------------------------------
# Test 09 — statistic action: upsert_stat chiamato, no webhook
# ---------------------------------------------------------------------------

async def test_action_router_statistic(tmp_path) -> None:
    store  = LanceDBStore(tmp_path / "db")
    await store.initialize()
    router = ActionRouter(AlertDedup(), store, None, None, None)

    scored = make_scored("person_count_stat", action="statistic")
    job    = make_clip_job()

    results = await router.route([scored], job, None, 300)

    assert results[0].fired is True
    assert results[0].action == "statistic"

    stats = await store.get_stats(area_id="lobby")
    assert len(stats) == 1
    assert stats[0]["signal_id"] == "person_count_stat"


# ---------------------------------------------------------------------------
# Test 10 — AlertPayload serializzazione JSON completa
# ---------------------------------------------------------------------------

def test_alert_payload_fields() -> None:
    import dataclasses
    p = make_alert_payload(
        llm_verdict={"confirmed": True, "description": "test", "confidence": 0.9}
    )
    d = dataclasses.asdict(p)
    assert d["event_id"] == "evt_test"
    assert d["llm_verdict"]["confirmed"] is True
    assert d["clip_path"] is None
