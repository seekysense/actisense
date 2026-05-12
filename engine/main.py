"""
Entrypoint del sistema VisionSemanticAgent.
Avvia il loop principale di polling, la priority queue con worker pool,
il watchdog dei servizi dipendenti e, opzionalmente, il server FastAPI.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import signal
import time
from pathlib import Path

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


# ---------------------------------------------------------------------------
# Mutable shared state — updated atomically on SIGHUP
# ---------------------------------------------------------------------------

class _State:
    def __init__(self, cfg, signal_cache, evaluator) -> None:
        self.cfg          = cfg
        self.signal_cache = signal_cache
        self.evaluator    = evaluator


# ---------------------------------------------------------------------------
# process_clip — called by ClipQueue worker for each job
# ---------------------------------------------------------------------------

def _make_processor(state: _State, embedding_client, router, clip_managers: dict):
    """Returns a ClipJob processor closure with access to shared state."""
    from engine.embedding.client import EmbeddingServiceUnavailable
    from engine.preprocessing.frame_extractor import extract_frames

    async def process_clip(job) -> None:
        cfg    = state.cfg
        camera = cfg.cameras.get(job.camera_id)
        if not camera:
            log.warning("camera_not_found", camera_id=job.camera_id)
            return

        area_cfg = cfg.areas.get(job.area_id)
        if not area_cfg:
            log.warning("area_not_found", area_id=job.area_id)
            return

        try:
            area_signals = cfg.active_signals_for_area(job.area_id)

            # Raggruppa signal per zona: un embed call per zona distinta.
            # Un signal con più zone appare in ogni gruppo corrispondente.
            from collections import defaultdict as _dd
            zone_groups: dict[str | None, list] = _dd(list)
            for pair in area_signals:
                zones = pair[1].zone  # list[str] | None
                if zones:
                    for z in zones:
                        zone_groups[z].append(pair)
                else:
                    zone_groups[None].append(pair)

            all_scored = []
            default_frame_set = None

            for zone_name, signal_pairs in zone_groups.items():
                frame_set = extract_frames(job.clip_path, camera, cfg,
                                           zone_name=zone_name)
                if default_frame_set is None and frame_set.frame_count > 0:
                    default_frame_set = frame_set
                scored = await state.evaluator.evaluate_windowed(
                    frame_set, embedding_client, job.camera_id,
                    job.area_id, signal_pairs,
                )
                all_scored.extend(scored)

            if default_frame_set is None:
                return

            cooldown = area_cfg.alert_cooldown_sec or cfg.site.alert_cooldown_sec
            await router.route(all_scored, job, default_frame_set, cooldown, area_cfg)

        except EmbeddingServiceUnavailable as exc:
            log.error("embedding_unavailable",
                      error=str(exc), recording_id=job.recording_id)
        except Exception as exc:
            log.error("process_clip_failed",
                      error=str(exc), recording_id=job.recording_id,
                      exc_info=True)
        finally:
            cm = clip_managers.get(job.camera_id)
            if cm:
                cm.mark_processed(job.recording_id)

    return process_clip


# ---------------------------------------------------------------------------
# poll_camera — background task per ogni telecamera
# ---------------------------------------------------------------------------

async def poll_camera(axis_client, clip_manager, queue, state: _State,
                      stop_event: asyncio.Event) -> None:
    last_cleanup = time.monotonic()

    while not stop_event.is_set():
        cfg = state.cfg
        try:
            clips = await clip_manager.fetch_new_clips(
                axis_client, event_id=None, lookback_sec=cfg.axis_poll_interval_sec * 3
            )
            for clip_path in clips:
                cam_id   = axis_client._camera.id
                area_id  = cfg.cameras[cam_id].area if cam_id in cfg.cameras else "unknown"
                area_signals = cfg.active_signals_for_area(area_id) if area_id in cfg.areas else []
                priority = min((sig.priority for _, sig in area_signals), default=3)
                job = __import__("engine.queue.priority_queue", fromlist=["ClipJob"]).ClipJob(
                    clip_path=clip_path,
                    camera_id=cam_id,
                    area_id=area_id,
                    recording_id=clip_path.stem,
                    enqueued_at=time.monotonic(),
                    priority=priority,
                )
                await queue.enqueue(job)

        except Exception as exc:
            log.warning("poll_camera_error",
                        camera_id=axis_client._camera.id, error=str(exc))

        # Cleanup every hour
        if time.monotonic() - last_cleanup > 3600:
            await clip_manager.cleanup_expired()
            last_cleanup = time.monotonic()

        # Interruptible sleep
        try:
            await asyncio.wait_for(
                asyncio.shield(stop_event.wait()),
                timeout=float(cfg.axis_poll_interval_sec),
            )
        except asyncio.TimeoutError:
            pass


# ---------------------------------------------------------------------------
# Main coroutine
# ---------------------------------------------------------------------------

async def main(config_path: Path, with_api: bool = False) -> None:
    from engine.telemetry import init_telemetry
    init_telemetry()

    from engine.config.loader import load_config
    from engine.config.signal_cache import SignalCache
    from engine.embedding.client import EmbeddingClient
    from engine.ingestion.axis_client import AxisClient
    from engine.ingestion.clip_manager import ClipManager
    from engine.intelligence.action_router import ActionRouter
    from engine.intelligence.llm_vision_client import LLMVisionClient
    from engine.intelligence.signal_evaluator import SignalEvaluator
    from engine.output.alert_dedup import AlertDedup
    from engine.output.notifier import Notifier
    from engine.queue.priority_queue import ClipQueue
    from engine.storage.clip_store import ClipStore
    from engine.storage.lancedb_store import LanceDBStore
    from engine.utils.health import HealthChecker
    from engine.utils.logger import configure_logging

    # 1. Config + logging
    cfg = load_config(config_path)
    configure_logging(cfg.log_level)
    log.info("engine_starting", site=cfg.site.id, areas=list(cfg.areas))

    # 2. Embedding service + signal cache
    embedding_client = EmbeddingClient(cfg.embedding_service_url)
    signal_cache     = SignalCache(embedding_client, cfg.signals)
    try:
        await signal_cache.warm_up()
        log.info("signal_cache_ready")
    except Exception as exc:
        log.warning("signal_cache_warm_failed", error=str(exc))

    # 3. Storage — resolve paths with fallback to tmp if configured path is read-only
    import tempfile as _tmpmod

    def _safe_dir(path: Path) -> Path:
        """Return path if writable, else a new temp dir."""
        try:
            path.mkdir(parents=True, exist_ok=True)
            return path
        except OSError:
            fb = Path(_tmpmod.mkdtemp()) / path.name
            fb.mkdir(parents=True, exist_ok=True)
            log.warning("path_inaccessible_fallback",
                        configured=str(path), fallback=str(fb))
            return fb

    lancedb_path  = _safe_dir(cfg.lancedb_path)
    storage_dir   = _safe_dir(cfg.clip_storage_dir)
    temp_dir      = _safe_dir(cfg.clip_temp_dir)

    store = LanceDBStore(lancedb_path)
    await store.initialize()
    clip_store = ClipStore(storage_dir, temp_dir)

    # 4. Output
    webhook_url = os.getenv("WEBHOOK_DEFAULT_URL",
                            "http://localhost:8000/api/internal/alert")
    notifier = Notifier(webhook_url)
    dedup    = AlertDedup()

    # 5. LLM client
    llm_client = LLMVisionClient(
        base_url=cfg.llm_base_url,
        api_key=os.getenv("LLM_API_KEY", ""),
        model=cfg.llm_vision_model,
        timeout=float(os.getenv("LLM_TIMEOUT", "280")),
        send_frame_size=int(os.getenv("LLM_FRAME_SIZE_SEND", "336")),
        send_jpeg_quality=int(os.getenv("LLM_JPEG_QUALITY_SEND", "80")),
        enable_thinking=cfg.llm_thinking,
    )

    # 6. Router + evaluator
    router    = ActionRouter(dedup, store, notifier, clip_store, llm_client,
                             llm_max_calls=cfg.llm_max_calls)
    evaluator = SignalEvaluator(signal_cache)

    state = _State(cfg, signal_cache, evaluator)

    # 7. Clip managers (one per camera, using resolved dirs)
    clip_managers: dict[str, ClipManager] = {}
    for cam_id in cfg.cameras:
        clip_managers[cam_id] = ClipManager(
            temp_dir=temp_dir,
            storage_dir=storage_dir,
            ttl_hours=int(os.getenv("CLIP_TEMP_TTL_HOURS", "24")),
        )

    # 8. Queue
    processor = _make_processor(state, embedding_client, router, clip_managers)
    queue     = ClipQueue(
        max_workers=cfg.queue_max_workers,
        max_depth=cfg.queue_max_depth,
        processor=processor,
    )

    # 9. Signal handlers
    loop        = asyncio.get_running_loop()
    stop_event  = asyncio.Event()

    def _shutdown_handler():
        if not stop_event.is_set():
            log.info("shutdown_signal_received")
            stop_event.set()

    async def _sighup_reload():
        try:
            new_cfg   = load_config(config_path)
            new_cache = SignalCache(embedding_client, new_cfg.signals)
            await new_cache.warm_up()
            state.cfg          = new_cfg
            state.signal_cache = new_cache
            state.evaluator._signal_cache = new_cache
            log.info("config_reloaded", site=new_cfg.site.id)
        except Exception as exc:
            log.error("config_reload_failed", error=str(exc))

    def _sighup_handler():
        asyncio.ensure_future(_sighup_reload())

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _shutdown_handler)
        except (OSError, ValueError):
            pass
    try:
        loop.add_signal_handler(signal.SIGHUP, _sighup_handler)
    except (OSError, AttributeError, ValueError):
        pass  # Windows doesn't have SIGHUP

    # 10. Background tasks
    health_checker = HealthChecker(embedding_client, llm_client, cfg)
    health_task    = asyncio.create_task(health_checker.watch_loop(interval_sec=60))

    axis_clients: list = []
    poll_tasks: list   = []
    for area in cfg.areas.values():
        for cam_id in area.cameras:
            camera = cfg.cameras.get(cam_id)
            if not camera or not camera.axis_ip:
                continue
            axis_client = AxisClient(
                camera=camera,
                default_user=cfg.axis_default_user,
                default_pass=cfg.axis_default_pass,
                download_fps=int(os.getenv("AXIS_DOWNLOAD_FPS", "4")),
            )
            axis_clients.append(axis_client)
            task = asyncio.create_task(
                poll_camera(
                    axis_client,
                    clip_managers[cam_id],
                    queue,
                    state,
                    stop_event,
                )
            )
            poll_tasks.append(task)

    if with_api:
        log.info("api_server_not_started", note="implement in Step 12")

    # 11. Start queue + wait for shutdown
    queue_task = asyncio.create_task(queue.start())
    log.info("engine_started", cameras=len(poll_tasks))

    await stop_event.wait()

    # 12. Graceful shutdown
    log.info("shutting_down")
    health_task.cancel()
    for t in poll_tasks:
        t.cancel()

    await queue.stop()
    queue_task.cancel()

    try:
        await asyncio.gather(health_task, *poll_tasks, return_exceptions=True)
    except Exception:
        pass

    log.info("shutdown_complete")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _parse_args():
    parser = argparse.ArgumentParser(description="VisionSemanticAgent engine")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("config/site.yaml"),
        help="Path to site.yaml",
    )
    parser.add_argument(
        "--with-api",
        action="store_true",
        help="Also start the FastAPI server (Step 12)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    asyncio.run(main(args.config, with_api=args.with_api))
