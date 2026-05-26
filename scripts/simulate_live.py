"""
Simula il monitoraggio costante delle telecamere usando video locali.

Alimenta il pipeline completo dell'engine (embedding → valutazione segnali → LLM →
webhook) in un loop continuo su file locali, così il pannello Live del dashboard
mostra attività reale in tempo reale.

Avvio rapido
───────────────
  # Terminale 1 — API
  uvicorn api.main:app --reload

  # Terminale 2 — Frontend
  cd frontend && npm run dev

  # Terminale 3 — Simulazione
  python scripts/simulate_live.py

Opzioni principali
──────────────────
  --video-dir PATH     Directory con i video (default: video-test/)
  --interval N         Secondi tra un clip e il successivo per camera (default: 20)
  --camera ID          Limita a una sola camera (default: tutte)
  --no-llm             Disabilita l'escalation LLM (più veloce)
  --config PATH        Percorso site.yaml (default: config/site.yaml)
  --api-url URL        URL dell'API locale (default: http://localhost:8000)
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import logging
import os
import sys
import time
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("simulate_live")

# Video extensions accettate
_VIDEO_EXTS = {".mp4", ".m4v", ".mkv", ".avi", ".mov"}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_dir(path: Path) -> Path:
    try:
        path.mkdir(parents=True, exist_ok=True)
        return path
    except OSError:
        fb = Path(tempfile.mkdtemp()) / path.name
        fb.mkdir(parents=True, exist_ok=True)
        log.warning("Path '%s' non accessibile, uso '%s'", path, fb)
        return fb


# ── Camera worker ─────────────────────────────────────────────────────────────

async def simulate_camera(
    camera_id: str,
    area_id: str,
    videos: list[Path],
    queue,
    interval_sec: float,
    stop_event: asyncio.Event,
    camera_live_stats: dict,
) -> None:
    """
    Loop infinito: infila un video alla volta nella ClipQueue con la stessa
    struttura di ClipJob che userebbe poll_camera in produzione.
    """
    from engine.queue.priority_queue import ClipJob
    from engine.telemetry.live_publisher import emit

    log.info("[%s] avvio simulazione  videos=%d  interval=%.0fs",
             camera_id, len(videos), interval_sec)

    for video, seq in zip(itertools.cycle(videos), itertools.count(1)):
        if stop_event.is_set():
            break

        recording_id = f"sim_{camera_id}_{seq:04d}_{video.stem}"
        job = ClipJob(
            clip_path=video,
            camera_id=camera_id,
            area_id=area_id,
            recording_id=recording_id,
            disk_id="",
            enqueued_at=time.monotonic(),
            priority=3,
        )

        enqueued = await queue.enqueue(job)

        # Aggiorna statistiche per il pannello heartbeat
        now = time.time()
        stats = camera_live_stats.setdefault(camera_id, {"clips_last_hour": 0, "reachable": True})
        stats["last_clip_at"] = now
        stats["reachable"] = True
        if enqueued:
            stats["clips_last_hour"] = stats.get("clips_last_hour", 0) + 1
            emit("clip_ingested",
                 camera_id=camera_id, area_id=area_id, recording_id=recording_id)
        else:
            emit("clip_dropped",
                 camera_id=camera_id, area_id=area_id,
                 recording_id=recording_id, detail="backpressure")

        log.info("[%s] clip %d queued: %s", camera_id, seq, video.name)

        # Attendi interval_sec (interrompibile da stop_event)
        try:
            await asyncio.wait_for(asyncio.shield(stop_event.wait()), timeout=interval_sec)
        except asyncio.TimeoutError:
            pass

    log.info("[%s] simulazione terminata", camera_id)


# ── Main ─────────────────────────────────────────────────────────────────────

async def run(args: argparse.Namespace) -> None:
    from dotenv import load_dotenv
    load_dotenv(_ROOT / ".env", override=False)

    os.environ.setdefault("INTERNAL_API_URL", args.api_url)
    os.environ.setdefault("WEBHOOK_DEFAULT_URL",
                          f"{args.api_url}/api/internal/alert")

    from engine.telemetry import init_telemetry
    init_telemetry()

    from engine.config.loader import load_config
    from engine.config.signal_cache import SignalCache
    from engine.embedding.client import EmbeddingClient
    from engine.intelligence.action_router import ActionRouter
    from engine.intelligence.llm_vision_client import LLMVisionClient
    from engine.intelligence.signal_evaluator import SignalEvaluator
    from engine.output.alert_dedup import AlertDedup
    from engine.output.notifier import Notifier
    from engine.queue.priority_queue import ClipQueue
    from engine.storage.clip_store import ClipStore
    from engine.storage.lancedb_store import LanceDBStore
    from engine.telemetry.live_publisher import emit_heartbeat
    from engine.main import _State, _make_processor

    # 1. Config
    cfg = load_config(args.config)
    log.info("Config: site=%s  areas=%s", cfg.site.id, list(cfg.areas))

    # 2. Selezione camere
    if args.camera:
        if args.camera not in cfg.cameras:
            log.error("Camera '%s' non trovata. Disponibili: %s",
                      args.camera, list(cfg.cameras))
            sys.exit(1)
        cameras_to_sim = {args.camera: cfg.cameras[args.camera]}
    else:
        cameras_to_sim = dict(cfg.cameras)

    # 3. Raccolta video
    video_dir = Path(args.video_dir)
    if not video_dir.exists():
        log.error("video-dir non trovata: %s", video_dir)
        sys.exit(1)
    videos = sorted(p for p in video_dir.iterdir() if p.suffix.lower() in _VIDEO_EXTS)
    if not videos:
        log.error("Nessun video trovato in %s (estensioni: %s)", video_dir, _VIDEO_EXTS)
        sys.exit(1)
    log.info("Video trovati: %d in %s", len(videos), video_dir)
    for v in videos:
        log.info("  %s", v.name)

    # 4. Embedding client + signal cache
    embedding_client = EmbeddingClient(
        cfg.embedding_base_url, timeout=60.0,
        model=cfg.embedding_model, api_key=cfg.embedding_api_key,
    )
    log.info("Riscaldamento signal cache  url=%s  model=%s ...",
             cfg.embedding_base_url, cfg.embedding_model or "(default)")
    try:
        signal_cache = SignalCache(embedding_client, cfg.signals)
        await signal_cache.warm_up()
        log.info("Signal cache pronta  (%d segnali)", len(cfg.signals))
    except Exception as exc:
        log.error("Signal cache fallita: %s", exc)
        sys.exit(1)

    # 5. Storage
    lancedb_path = _safe_dir(cfg.lancedb_path)
    storage_dir  = _safe_dir(cfg.clip_storage_dir)
    temp_dir     = _safe_dir(cfg.clip_temp_dir)

    store      = LanceDBStore(lancedb_path)
    clip_store = ClipStore(storage_dir, temp_dir)
    await store.initialize()
    log.info("LanceDB pronto: %s", lancedb_path)

    # 6. LLM client
    llm_client = None
    if not args.no_llm:
        llm_client = LLMVisionClient(
            base_url=cfg.llm_base_url,
            api_key=os.getenv("LLM_API_KEY", ""),
            model=cfg.llm_vision_model,
            timeout=float(os.getenv("LLM_TIMEOUT", "280")),
            send_frame_size=int(os.getenv("LLM_FRAME_SIZE_SEND", "336")),
            send_jpeg_quality=int(os.getenv("LLM_JPEG_QUALITY_SEND", "80")),
            enable_thinking=cfg.llm_thinking,
            use_reasoning=cfg.llm_use_reasoning,
        )
        log.info("LLM: %s / %s", cfg.llm_base_url, cfg.llm_vision_model)
    else:
        log.info("LLM escalation disabilitata (--no-llm)")

    # 7. Pipeline
    notifier  = Notifier(os.environ["WEBHOOK_DEFAULT_URL"])
    dedup     = AlertDedup()
    evaluator = SignalEvaluator(signal_cache)
    router    = ActionRouter(dedup, store, notifier, clip_store, llm_client,
                             llm_max_calls=cfg.llm_max_calls, clip_on_camera=False)

    # ClipManager mock — la simulazione non ha Axis da cui scaricare
    class _NullClipManager:
        def mark_processed(self, _recording_id: str) -> None:
            pass

    clip_managers = {cam_id: _NullClipManager() for cam_id in cameras_to_sim}

    state     = _State(cfg, signal_cache, evaluator)
    processor = _make_processor(state, embedding_client, router, clip_managers)

    # 8. Queue
    queue = ClipQueue(
        max_workers=cfg.queue_max_workers,
        max_depth=cfg.queue_max_depth,
        processor=processor,
    )

    stop_event        = asyncio.Event()
    camera_live_stats: dict = {}

    # 9. Heartbeat loop → aggiorna pannello Live ogni 5s
    async def _heartbeat_loop() -> None:
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(asyncio.shield(stop_event.wait()), timeout=5.0)
            except asyncio.TimeoutError:
                pass
            if stop_event.is_set():
                break
            cams = [{"camera_id": cid, **s} for cid, s in camera_live_stats.items()]
            emit_heartbeat(queue.stats(), cams)

    # 10. Gestione Ctrl+C
    loop = asyncio.get_running_loop()

    def _on_sigint():
        if not stop_event.is_set():
            log.info("Interruzione ricevuta — shutdown in corso…")
            stop_event.set()

    try:
        import signal as _signal
        loop.add_signal_handler(_signal.SIGINT,  _on_sigint)
        loop.add_signal_handler(_signal.SIGTERM, _on_sigint)
    except (OSError, NotImplementedError):
        pass

    # 11. Avvio task
    queue_task     = asyncio.create_task(queue.start())
    heartbeat_task = asyncio.create_task(_heartbeat_loop())

    cam_tasks = []
    for cam_id, cam_cfg in cameras_to_sim.items():
        area_id = cam_cfg.area
        if area_id not in cfg.areas:
            log.warning("Area '%s' per camera '%s' non trovata — skip", area_id, cam_id)
            continue
        if not cfg.active_signals_for_area(area_id):
            log.warning("Nessun segnale attivo per area '%s' — skip camera '%s'",
                        area_id, cam_id)
            continue
        t = asyncio.create_task(
            simulate_camera(cam_id, area_id, videos, queue,
                            args.interval, stop_event, camera_live_stats)
        )
        cam_tasks.append(t)

    if not cam_tasks:
        log.error("Nessuna camera simulabile trovata")
        stop_event.set()
    else:
        log.info("")
        log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        log.info("  Simulazione avviata  —  Ctrl+C per fermare")
        log.info("  Camere: %s", [t.get_name() for t in cam_tasks])
        log.info("  Intervallo: %.0f s per camera", args.interval)
        log.info("  Apri il dashboard e clicca 'Live'")
        log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        log.info("")

    await stop_event.wait()

    # 12. Shutdown
    heartbeat_task.cancel()
    for t in cam_tasks:
        t.cancel()
    await queue.stop()
    queue_task.cancel()
    await asyncio.gather(heartbeat_task, *cam_tasks, return_exceptions=True)
    log.info("Shutdown completato.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def _parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--video-dir", default=str(_ROOT / "video-test"),
                   help="Directory con i video da ciclare (default: video-test/)")
    p.add_argument("--interval", type=float, default=20.0,
                   help="Secondi tra un clip e il successivo per camera (default: 20)")
    p.add_argument("--camera", default=None,
                   help="Limita la simulazione a una sola camera")
    p.add_argument("--no-llm", action="store_true",
                   help="Disabilita l'escalation LLM (più veloce, meno crediti)")
    p.add_argument("--config", type=Path, default=_ROOT / "config/site.yaml",
                   help="Percorso site.yaml (default: config/site.yaml)")
    p.add_argument("--api-url", default="http://localhost:8000",
                   help="URL API locale (default: http://localhost:8000)")
    return p.parse_args()


if __name__ == "__main__":
    asyncio.run(run(_parse()))
