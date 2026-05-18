"""Test di integrazione end-to-end del pipeline completo — Step 11."""
from __future__ import annotations

import asyncio
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
from aiohttp import web

from engine.config.signal_cache import SignalCache
from engine.embedding.client import EmbeddingClient, EmbeddingServiceUnavailable
from engine.intelligence.action_router import ActionResult, ActionRouter
from engine.intelligence.signal_evaluator import SignalEvaluator
from engine.output.alert_dedup import AlertDedup
from engine.output.notifier import Notifier
from engine.preprocessing.frame_extractor import extract_frames
from engine.queue.priority_queue import ClipJob, ClipQueue
from engine.storage.clip_store import ClipStore
from engine.storage.lancedb_store import LanceDBStore
from engine.utils.health import HealthChecker
from engine.utils.logger import configure_logging


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def make_job(priority: int = 2, path: str = "test.mp4") -> ClipJob:
    return ClipJob(
        clip_path=Path(path),
        camera_id="cam_test",
        area_id="lobby",
        recording_id=f"rec_{path}",
        enqueued_at=time.monotonic(),
        priority=priority,
    )


# ---------------------------------------------------------------------------
# Test 01 — pipeline completo su video armadio.mp4
# ---------------------------------------------------------------------------

async def test_pipeline_local_video(tmp_path, cfg, aiohttp_server) -> None:
    """
    Simula il flusso completo usando video locale invece di clip VAPIX.
    Richiede embedding service.
    """
    embedding_client = EmbeddingClient(
        cfg.embedding_base_url, model=cfg.embedding_model, api_key=cfg.embedding_api_key
    )
    if not await embedding_client.health_check():
        pytest.skip("Embedding service non disponibile")

    received_alerts: list[dict] = []

    async def webhook_handler(request: web.Request) -> web.Response:
        received_alerts.append(await request.json())
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post("/webhook", webhook_handler)
    server = await aiohttp_server(app)

    signal_cache = SignalCache(embedding_client, cfg.signals)
    await signal_cache.warm_up()

    store      = LanceDBStore(tmp_path / "db")
    await store.initialize()
    clip_store = ClipStore(tmp_path / "storage", tmp_path / "temp")
    notifier   = Notifier(f"http://localhost:{server.port}/webhook")
    dedup      = AlertDedup()
    router     = ActionRouter(dedup, store, notifier, clip_store, llm_client=None)
    evaluator  = SignalEvaluator(signal_cache)

    video_path   = Path("video-test/armadio.mp4")
    camera       = list(cfg.cameras.values())[0]
    area_id      = camera.area
    area_cfg     = cfg.areas[area_id]
    area_signals = cfg.active_signals_for_area(area_id)

    frame_set  = extract_frames(video_path, camera, cfg)
    video_vec  = await embedding_client.embed_video(frame_set.frames_embedder)
    scored     = await evaluator.evaluate({camera.id: video_vec}, area_id, area_signals)

    job = ClipJob(
        clip_path=video_path,
        camera_id=camera.id,
        area_id=area_id,
        recording_id="test_rec_001",
        enqueued_at=time.monotonic(),
        priority=min((sig.priority for _, sig in area_signals), default=3),
    )

    cooldown = area_cfg.alert_cooldown_sec or cfg.site.alert_cooldown_sec
    results  = await router.route(scored, job, frame_set, cooldown, area_cfg)

    print(f"\nProcessed {len(scored)} signals:")
    for r in results:
        print(f"  {r.signal_id}: action={r.action}, fired={r.fired}, "
              f"score={r.score:.4f}")

    assert len(results) > 0
    assert all(isinstance(r, ActionResult) for r in results)


# ---------------------------------------------------------------------------
# Test 02 — SIGHUP ricarica config senza crash — AC-05
# ---------------------------------------------------------------------------

async def test_sighup_reload(tmp_path) -> None:
    """Avvia engine, invia SIGHUP, verifica che non crashi."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "engine.main", "--config", "config/site.yaml"],
        cwd=str(Path.cwd()),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        await asyncio.sleep(4)
        assert proc.poll() is None, "Engine crashed during startup"

        proc.send_signal(signal.SIGHUP)
        await asyncio.sleep(2)

        assert proc.poll() is None, "Engine crashed after SIGHUP"
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


# ---------------------------------------------------------------------------
# Test 03 — embedding service down → errore catturato, worker non crasha
# ---------------------------------------------------------------------------

async def test_embedding_service_down(tmp_path) -> None:
    bad_client = EmbeddingClient("http://localhost:19999")
    with pytest.raises(EmbeddingServiceUnavailable):
        await bad_client.embed_video(["fake"])

    processed_errors: list[str] = []

    async def failing_processor(job: ClipJob) -> None:
        try:
            await bad_client.embed_video(["fake"])
        except EmbeddingServiceUnavailable as exc:
            processed_errors.append(str(exc))

    q    = ClipQueue(max_workers=1, max_depth=10, processor=failing_processor)
    task = asyncio.create_task(q.start())
    await q.enqueue(make_job(priority=1, path="test.mp4"))
    await asyncio.sleep(0.3)
    await q.stop()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    assert len(processed_errors) == 1


# ---------------------------------------------------------------------------
# Test 04 — pipeline su video locker.mp4
# ---------------------------------------------------------------------------

async def test_pipeline_locker_video(tmp_path, cfg) -> None:
    embedding_client = EmbeddingClient(
        cfg.embedding_base_url, model=cfg.embedding_model, api_key=cfg.embedding_api_key
    )
    if not await embedding_client.health_check():
        pytest.skip("Embedding service non disponibile")

    signal_cache = SignalCache(embedding_client, cfg.signals)
    await signal_cache.warm_up()

    camera       = list(cfg.cameras.values())[0]
    area_id      = camera.area
    area_signals = cfg.active_signals_for_area(area_id)

    frame_set  = extract_frames(Path("video-test/locker.mp4"), camera, cfg)
    video_vec  = await embedding_client.embed_video(frame_set.frames_embedder)
    evaluator  = SignalEvaluator(signal_cache)
    scored     = await evaluator.evaluate({camera.id: video_vec}, area_id, area_signals)

    print(f"\nLocker video scores (top 5):")
    for s in sorted(scored, key=lambda x: x.score, reverse=True)[:5]:
        print(f"  {s.signal_id}: {s.score:.4f} (threshold {s.threshold}, "
              f"exceeds={s.exceeds_threshold})")

    assert len(scored) > 0


# ---------------------------------------------------------------------------
# Test 05 — configure_logging non crasha
# ---------------------------------------------------------------------------

def test_configure_logging_info() -> None:
    configure_logging("INFO")
    configure_logging("DEBUG")
    configure_logging("WARNING")


# ---------------------------------------------------------------------------
# Test 06 — HealthChecker.check_all restituisce chiavi attese
# ---------------------------------------------------------------------------

async def test_health_checker_structure(cfg) -> None:
    from engine.intelligence.llm_vision_client import LLMVisionClient
    embedding_client = EmbeddingClient(
        cfg.embedding_base_url, model=cfg.embedding_model, api_key=cfg.embedding_api_key
    )
    llm_client = LLMVisionClient(
        base_url=cfg.llm_base_url,
        api_key="",
        model=cfg.llm_vision_model,
        timeout=5.0,
    )
    checker = HealthChecker(embedding_client, llm_client, cfg)
    result = await checker.check_all()

    assert "embedding" in result
    assert "llm" in result
    assert "cameras" in result
    assert isinstance(result["embedding"], bool)
    assert isinstance(result["llm"], bool)
    assert isinstance(result["cameras"], dict)
    # cam_kitchen_01 deve essere nel dizionario
    assert "cam_kitchen_01" in result["cameras"]
