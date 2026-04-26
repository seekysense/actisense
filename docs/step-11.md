# Step 11 — Main engine loop + SIGHUP reload + health watchdog

## Obiettivo

Implementare `engine/main.py`, `engine/utils/logger.py`, `engine/utils/health.py`: entrypoint del sistema, loop principale, ricarica config via SIGHUP, watchdog servizi dipendenti, graceful shutdown.

## File da implementare

```
engine/
├── main.py

engine/utils/
├── logger.py    # structured logging JSON via structlog
└── health.py    # health check loop tutti i servizi

tests/
└── test_integration.py
```

## `engine/utils/logger.py`

```python
import structlog

def configure_logging(level: str = "INFO") -> None:
    """Configura structlog con output JSON a stdout."""
    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.stdlib.add_log_level,
            structlog.processors.JSONRenderer(),
        ],
        ...
    )
```

Nessun parametro da `.env` qui — `LOG_LEVEL` viene letto in `main.py`.

## `engine/utils/health.py`

### `HealthChecker`
```python
class HealthChecker:
    def __init__(self, embedding_client: EmbeddingClient,
                 llm_client: LLMVisionClient, cfg: SiteConfig): ...

    async def check_all(self) -> dict[str, bool]:
        """
        Ritorna: {"embedding": bool, "llm": bool, "cameras": {cam_id: bool}}
        """

    async def watch_loop(self, interval_sec: int = 60) -> None:
        """Ogni interval_sec: check_all + log risultati. Continuo."""
```

### `check_all()` usato dall'API FastAPI
`HealthChecker` non avvia nessun server HTTP autonomo. Il risultato di `check_all()` viene esposto dall'endpoint `GET /health` del server FastAPI (Step 12). Il `HealthChecker` viene passato come dependency alla FastAPI app all'avvio.

## `engine/main.py`

### Struttura
```python
async def main(config_path: Path) -> None:
    # 1. Configura logging
    # 2. Carica SiteConfig
    # 3. Inizializza SignalCache (warm up embedding)
    # 4. Inizializza LanceDBStore
    # 5. Inizializza ClipQueue con processor=process_clip
    # 6. Registra SIGHUP handler
    # 7. Avvia HealthChecker.watch_loop in background
    # 8. Per ogni camera: avvia polling loop in background
    # 9. Avvia ClipQueue.start() (blocca fino a stop)

async def process_clip(job: ClipJob, cfg: SiteConfig, ...) -> None:
    """
    Processor per ogni job in coda:
    1. extract_frames(job.clip_path, camera, cfg)
    2. embed_video(frame_set.frames_embedder)
    3. signal_evaluator.evaluate(embeddings, area_id, area_signals)
    4. action_router.route(scored_signals, job, frame_set, cooldown, area_cfg)
    5. clip_manager.mark_processed(job.recording_id)
    """

async def poll_camera(axis_client: AxisClient, clip_manager: ClipManager,
                       queue: ClipQueue, cfg: SiteConfig) -> None:
    """
    Loop ogni AXIS_POLL_INTERVAL_SEC:
    1. fetch_new_clips() → lista Path
    2. Per ogni clip: calcola priority minima area → enqueue(ClipJob)
    3. cleanup_expired() ogni ora
    """

def setup_sighup(cfg_path: Path, reload_callback: Callable) -> None:
    """
    UNIX signal handler per SIGHUP.
    Su ricezione: chiama reload_callback(load_config(cfg_path))
    """
```

### Graceful shutdown (SIGTERM / SIGINT)
```python
# Su SIGTERM/SIGINT:
# 1. Ferma polling loop
# 2. ClipQueue.stop() — aspetta job in corso
# 3. Chiude LanceDB
# 4. Log "shutdown complete"
```

### Avvio da CLI
```bash
# Solo engine (senza API server)
python -m engine.main --config config/site.yaml

# Engine + API server insieme (avvia uvicorn in background task)
python -m engine.main --config config/site.yaml --with-api
```

## `tests/test_integration.py`

```python
pytestmark = pytest.mark.asyncio

# Test 1: pipeline completo su video armadio.mp4 (senza telecamera reale)
async def test_pipeline_local_video(tmp_path, cfg, aiohttp_server):
    """
    Simula il flusso completo usando video locale invece di clip VAPIX.
    Servizi richiesti: embedding (reale o mock).
    """
    received_alerts = []

    async def webhook_handler(request):
        received_alerts.append(await request.json())
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post("/webhook", webhook_handler)
    server = await aiohttp_server(app)

    # Override webhook URL
    monkeypatch_cfg = ...  # cfg con webhook puntato a test server

    # Setup pipeline
    embedding_client = EmbeddingClient(cfg.embedding_service_url)
    signal_cache = SignalCache(embedding_client, cfg.signals)
    await signal_cache.warm_up()

    store = LanceDBStore(tmp_path / "db")
    await store.initialize()
    clip_store = ClipStore(tmp_path / "storage", tmp_path / "temp")
    notifier = Notifier(f"http://localhost:{server.port}/webhook")
    dedup = AlertDedup()
    llm_client = None   # disabilitato per velocità
    router = ActionRouter(dedup, store, notifier, clip_store, llm_client)
    evaluator = SignalEvaluator(signal_cache)

    # Esegui pipeline su video test
    video_path = Path("video-test/armadio.mp4")
    camera = list(cfg.cameras.values())[0]
    area_id = camera.area

    frame_set = extract_frames(video_path, camera, cfg)
    video_vec = await embedding_client.embed_video(frame_set.frames_embedder)
    area_signals = cfg.active_signals_for_area(area_id)
    scored = await evaluator.evaluate({camera.id: video_vec}, area_id, area_signals)

    job = ClipJob(
        clip_path=video_path,
        camera_id=camera.id,
        area_id=area_id,
        recording_id="test_rec_001",
        enqueued_at=time.monotonic(),
        priority=min(s.signal.priority for _, s in area_signals) if area_signals else 3,
    )

    area_cfg = cfg.areas[area_id]
    results = await router.route(scored, job, frame_set, area_cfg.alert_cooldown_sec or cfg.site.alert_cooldown_sec, area_cfg)

    print(f"\nProcessed {len(scored)} signals:")
    for r in results:
        print(f"  {r.signal_id}: action={r.action}, fired={r.fired}, score={r.score:.4f}")

    # Almeno un risultato processato
    assert len(results) > 0
    # Nessun crash
    assert all(isinstance(r, ActionResult) for r in results)

# Test 2: SIGHUP ricarioca config senza perdere job in corso — AC-05
async def test_sighup_reload(tmp_path, cfg):
    """
    Avvia processo engine, invia SIGHUP, verifica che ricarichi e non crashi.
    """
    import subprocess, signal, time
    proc = subprocess.Popen(
        ["python", "-m", "engine.main", "--config", "config/site.yaml"],
        cwd=str(Path.cwd()),
    )
    await asyncio.sleep(3)   # attendi avvio
    assert proc.poll() is None   # processo ancora in vita

    proc.send_signal(signal.SIGHUP)
    await asyncio.sleep(2)   # attendi reload

    assert proc.poll() is None   # ancora in vita dopo SIGHUP

    proc.terminate()
    await asyncio.sleep(1)
    # AC-05: il processo non crasha

# Test 3: embedding service down → clip in retry — AC-08
async def test_embedding_service_down(tmp_path, cfg):
    """
    Simula embedding service non disponibile.
    Verifica: nessun crash del processo, clip messo in retry.
    """
    bad_client = EmbeddingClient("http://localhost:19999")
    with pytest.raises(EmbeddingServiceUnavailable):
        await bad_client.embed_video(["fake"])

    # Il ClipQueue processor deve catturare l'eccezione e non propagarla
    processed_errors = []

    async def failing_processor(job):
        try:
            await bad_client.embed_video(["fake"])
        except EmbeddingServiceUnavailable as e:
            processed_errors.append(str(e))
            # Non propagare — il worker non deve crashare

    q = ClipQueue(max_workers=1, max_depth=10, processor=failing_processor)
    task = asyncio.create_task(q.start())
    await q.enqueue(make_job(priority=1, path="test.mp4"))
    await asyncio.sleep(0.2)
    await q.stop()
    task.cancel()

    assert len(processed_errors) == 1   # errore catturato, non propagato

# Test 4: pipeline su video locker.mp4
async def test_pipeline_locker_video(tmp_path, cfg):
    embedding_client = EmbeddingClient(cfg.embedding_service_url)
    if not await embedding_client.health_check():
        pytest.skip("Embedding service non disponibile")

    signal_cache = SignalCache(embedding_client, cfg.signals)
    await signal_cache.warm_up()

    camera = list(cfg.cameras.values())[0]
    area_id = camera.area
    frame_set = extract_frames(Path("video-test/locker.mp4"), camera, cfg)
    video_vec = await embedding_client.embed_video(frame_set.frames_embedder)

    evaluator = SignalEvaluator(signal_cache)
    area_signals = cfg.active_signals_for_area(area_id)
    scored = await evaluator.evaluate({camera.id: video_vec}, area_id, area_signals)

    print(f"\nLocker video scores:")
    for s in sorted(scored, key=lambda x: x.score, reverse=True)[:5]:
        print(f"  {s.signal_id}: {s.score:.4f} (threshold {s.threshold})")

    assert len(scored) > 0
```

### Esecuzione test
```bash
source .venv/bin/activate

# Test integrazione completa (richiede embedding service)
pytest tests/test_integration.py -v -s

# Solo test locali
pytest tests/test_integration.py -v -k "embedding_service_down"
```

### Test end-to-end manuale
```bash
source .venv/bin/activate

# 1. Verifica embedding service
curl http://localhost:6756/health

# 2. Avvia engine + API server
python -m engine.main --config config/site.yaml --with-api &
ENGINE_PID=$!

# 3. Verifica health endpoint FastAPI (Step 12)
sleep 3 && curl http://localhost:8000/health | python -m json.tool

# 4. Test SIGHUP reload
kill -HUP $ENGINE_PID && sleep 2 && echo "Engine ancora vivo: $(kill -0 $ENGINE_PID && echo SI)"

# 5. Stop
kill $ENGINE_PID
```

## Criteri di accettazione

- Pipeline completo: video → embedding → scoring → action senza crash
- SIGHUP ricarica config senza perdere job in coda — AC-05
- Embedding service down → errore catturato, processo non crasha — AC-08
- `HealthChecker.check_all()` restituisce stato di embedding, LLM e camere

## Dipendenze

- Tutti gli step precedenti (02–10) completati
- Servizio embedding disponibile per test di integrazione
