"""Test suite per engine/intelligence/ (evaluator, router, dedup) — Step 07."""
from __future__ import annotations

import time
from datetime import time as dt_time
from pathlib import Path

import pytest

from engine.config.models import AreaSignal, Signal
from engine.intelligence.action_router import ActionResult, ActionRouter
from engine.intelligence.signal_evaluator import (
    ScoredSignal,
    SignalEvaluator,
    _within_time_filter,
)
from engine.output.alert_dedup import AlertDedup
from engine.queue.priority_queue import ClipJob


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def make_clip_job(area_id: str = "lobby") -> ClipJob:
    return ClipJob(
        clip_path=Path("clip.mp4"),
        camera_id="cam_test",
        area_id=area_id,
        recording_id="rec_test",
        enqueued_at=time.monotonic(),
        priority=2,
    )


# ---------------------------------------------------------------------------
# Test 01 — scoring reale vs video armadio (richiede embedding service)
# ---------------------------------------------------------------------------

async def test_score_above_threshold(signal_cache, cfg) -> None:
    from engine.embedding.client import EmbeddingClient
    from engine.preprocessing.frame_extractor import extract_frames

    evaluator = SignalEvaluator(signal_cache)
    area_id = "kitchen"
    area_signals = cfg.active_signals_for_area(area_id)

    client = EmbeddingClient(
        cfg.embedding_base_url, model=cfg.embedding_model, api_key=cfg.embedding_api_key
    )
    fs = extract_frames(
        Path("video-test/armadio.mp4"),
        list(cfg.cameras.values())[0],
        cfg,
    )
    from engine.embedding.client import EmbeddingServiceUnavailable
    try:
        vec = await client.embed_video(fs.frames_embedder)
    except EmbeddingServiceUnavailable:
        pytest.skip("Video embedding model not available (Galene/Embedding-Vision not deployed)")
    embeddings = {"cam_kitchen_01": vec}

    results = await evaluator.evaluate(embeddings, area_id, area_signals)
    assert len(results) > 0
    # Nessun signal native_axis nei risultati
    for r in results:
        assert r.signal.source != "native_axis"
        print(f"  {r.signal_id}: score={r.score:.4f} threshold={r.threshold} "
              f"exceeds={r.exceeds_threshold}")


# ---------------------------------------------------------------------------
# Test 02 — time_filter esclude signal fuori finestra oraria (locale)
# ---------------------------------------------------------------------------

def test_time_filter_excludes_narrow_window() -> None:
    # Finestra 01:00-01:01 — alle 12:00 deve essere fuori
    assert _within_time_filter(
        {"from": "01:00", "to": "01:01"},
        now_time=dt_time(12, 0),
    ) is False
    # Alle 01:00 deve essere dentro
    assert _within_time_filter(
        {"from": "01:00", "to": "01:01"},
        now_time=dt_time(1, 0),
    ) is True


# ---------------------------------------------------------------------------
# Test 03 — time_filter overnight (from > to) — locale
# ---------------------------------------------------------------------------

def test_time_filter_overnight() -> None:
    # Range 22:00-07:00
    assert _within_time_filter(
        {"from": "22:00", "to": "07:00"},
        now_time=dt_time(23, 0),
    ) is True    # dentro (notte)
    assert _within_time_filter(
        {"from": "22:00", "to": "07:00"},
        now_time=dt_time(3, 0),
    ) is True    # dentro (mattina presto)
    assert _within_time_filter(
        {"from": "22:00", "to": "07:00"},
        now_time=dt_time(12, 0),
    ) is False   # fuori (mezzogiorno)


# ---------------------------------------------------------------------------
# Test 04 — signal source=native_axis escluso dall'evaluator
# ---------------------------------------------------------------------------

async def test_native_axis_signal_excluded(signal_cache, cfg) -> None:
    evaluator = SignalEvaluator(signal_cache)
    area_signals = cfg.active_signals_for_area("kitchen")
    native_signals = [(as_, sig) for as_, sig in area_signals
                      if sig.source == "native_axis"]
    if not native_signals:
        pytest.skip("Nessun signal native_axis in config kitchen")

    from engine.storage.lancedb_store import EMB_DIM
    vec = [0.0] * EMB_DIM
    results = await evaluator.evaluate({"cam_test": vec}, "kitchen", area_signals)
    result_ids = {r.signal_id for r in results}
    for as_, sig in native_signals:
        assert sig.id not in result_ids


# ---------------------------------------------------------------------------
# Test 05 — multi-cam max aggregation (locale, senza embedding service)
# ---------------------------------------------------------------------------

async def test_multicam_max_score(signal_cache) -> None:
    signal = Signal(id="s1", text="test signal")
    as_ = AreaSignal(signal_id="s1")
    # Embedding manuale: vettore unitario sulla dimensione 0
    signal_cache._cache["s1"] = [1.0] + [0.0] * 511

    evaluator = SignalEvaluator(signal_cache)
    vec_low  = [0.3] + [0.0] * 511   # dot product = 0.3
    vec_high = [0.9] + [0.0] * 511   # dot product = 0.9
    embeddings = {"cam1": vec_low, "cam2": vec_high}

    results = await evaluator.evaluate(embeddings, "test_area", [(as_, signal)])
    assert len(results) == 1
    assert abs(results[0].score - 0.9) < 0.01   # max, non media


# ---------------------------------------------------------------------------
# Test 06 — threshold_override applicato correttamente
# ---------------------------------------------------------------------------

async def test_threshold_override(signal_cache) -> None:
    signal = Signal(id="s2", text="test", default_threshold=0.8)
    as_ = AreaSignal(signal_id="s2", threshold_override=0.3)
    signal_cache._cache["s2"] = [1.0] + [0.0] * 511

    evaluator = SignalEvaluator(signal_cache)
    vec = [0.5] + [0.0] * 511     # score=0.5 > override=0.3 → True
    results = await evaluator.evaluate({"cam1": vec}, "area", [(as_, signal)])
    assert results[0].exceeds_threshold is True
    assert results[0].threshold == pytest.approx(0.3)


# ---------------------------------------------------------------------------
# Test 07 — cooldown blocca secondo alert (locale)
# ---------------------------------------------------------------------------

async def test_cooldown_dedup() -> None:
    dedup = AlertDedup()
    assert await dedup.should_fire("lobby", "smoking", cooldown_sec=300) is True
    await dedup.record_fired("lobby", "smoking")
    assert await dedup.should_fire("lobby", "smoking", cooldown_sec=300) is False


# ---------------------------------------------------------------------------
# Test 08 — cooldown=0 → alert passa immediatamente
# ---------------------------------------------------------------------------

async def test_cooldown_expired() -> None:
    dedup = AlertDedup()
    await dedup.record_fired("lobby", "smoking")
    assert await dedup.should_fire("lobby", "smoking", cooldown_sec=0) is True


# ---------------------------------------------------------------------------
# Test 09 — ActionRouter dispatcha statistic senza crash con store=None
# ---------------------------------------------------------------------------

async def test_action_router_statistic() -> None:
    dedup = AlertDedup()
    router = ActionRouter(dedup, None, None, None, None)

    signal = Signal(id="s3", text="t", default_action="statistic")
    as_ = AreaSignal(signal_id="s3")
    scored = ScoredSignal(
        signal_id="s3",
        score=0.6,
        threshold=0.5,
        action="statistic",
        exceeds_threshold=True,
        area_signal=as_,
        signal=signal,
    )
    results = await router.route([scored], make_clip_job(), None, 300)
    assert results[0].action == "statistic"
    assert results[0].fired is True


# ---------------------------------------------------------------------------
# Test 10 — ActionRouter blocca secondo alert per cooldown
# ---------------------------------------------------------------------------

async def test_action_router_cooldown_block() -> None:
    dedup = AlertDedup()
    router = ActionRouter(dedup, None, None, None, None)

    signal = Signal(id="s4", text="t", default_action="notify", cooldown_sec=300)
    as_ = AreaSignal(signal_id="s4")
    scored = ScoredSignal(
        signal_id="s4",
        score=0.7,
        threshold=0.5,
        action="notify",
        exceeds_threshold=True,
        area_signal=as_,
        signal=signal,
    )
    # Prima chiamata → fired
    r1 = await router.route([scored], make_clip_job(), None, 300)
    assert r1[0].fired is True

    # Seconda chiamata immediata → bloccata da cooldown
    r2 = await router.route([scored], make_clip_job(), None, 300)
    assert r2[0].fired is False


# ---------------------------------------------------------------------------
# Test 11 — time_filter None → sempre dentro range
# ---------------------------------------------------------------------------

def test_time_filter_none() -> None:
    assert _within_time_filter(None) is True
    assert _within_time_filter({}) is True


# ---------------------------------------------------------------------------
# Test 12 — AlertDedup.reset() svuota il cooldown
# ---------------------------------------------------------------------------

async def test_alert_dedup_reset() -> None:
    dedup = AlertDedup()
    await dedup.record_fired("lobby", "fire_smoke")
    assert await dedup.should_fire("lobby", "fire_smoke", cooldown_sec=300) is False
    dedup.reset()
    assert await dedup.should_fire("lobby", "fire_smoke", cooldown_sec=300) is True
