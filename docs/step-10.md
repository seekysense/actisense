# Step 10 — Alert output (notifier + dedup)

## Obiettivo

Implementare `engine/output/notifier.py` completo: webhook HTTP, payload strutturato, `send()` vs `send_priority()`. Completare l'integrazione `ActionRouter` con storage e notifier reali. Testato con webhook mock e poi con integrazioni reali.

## File da implementare / completare

```
engine/output/
└── notifier.py          # webhook HTTP POST

engine/intelligence/
└── action_router.py     # (completare con store + notifier reali da Step 07)

tests/
└── test_output.py
```

## `engine/output/notifier.py`

### Payload alert
```python
@dataclass
class AlertPayload:
    event_id: str
    timestamp: str           # ISO 8601 UTC
    area_id: str
    area_name: str
    signal_id: str
    signal_text: str
    score: float
    action: str              # "notify" | "alarm"
    priority: int
    clip_path: str | None
    llm_verdict: dict | None   # {"confirmed": bool, "description": str, "confidence": float}
    camera_id: str
```

### `Notifier`
```python
class Notifier:
    def __init__(self, webhook_url: str, timeout: float = 10.0): ...

    async def send(self, payload: AlertPayload) -> bool:
        """POST webhook con action=notify. Ritorna True se 2xx."""

    async def send_priority(self, payload: AlertPayload) -> bool:
        """POST webhook con action=alarm e header X-VSA-Priority: critical"""

    async def _post(self, payload: AlertPayload, headers: dict) -> bool:
        """
        aiohttp POST.
        HTTP 4xx/5xx: log error, ritorna False (non eccezione).
        Timeout: log warning, ritorna False.
        """
```

### Formato payload JSON inviato
```json
{
  "event_id": "uuid",
  "timestamp": "2025-04-23T14:30:00.000Z",
  "area_id": "lobby",
  "area_name": "Lobby ingresso",
  "signal_id": "smoking",
  "signal_text": "persona che fuma o tiene una sigaretta accesa",
  "score": 0.72,
  "action": "notify",
  "priority": 2,
  "clip_path": "/data/vsa_storage/lobby/2025-04-23/evt_abc.mp4",
  "llm_verdict": {"confirmed": true, "description": "...", "confidence": 0.88},
  "camera_id": "cam_lobby_01"
}
```

## Completamento `engine/intelligence/action_router.py`

Wiring completo con tutte le dipendenze reali:

```python
async def route(self, scored_signals, clip_job, frame_set, area_cooldown_sec, area_config):
    results = []
    for scored in scored_signals:
        if not scored.exceeds_threshold:
            results.append(ActionResult(..., action="skipped", fired=False))
            continue

        cooldown = scored.signal.cooldown_sec or area_cooldown_sec
        if not await self._dedup.should_fire(clip_job.area_id, scored.signal_id, cooldown):
            results.append(ActionResult(..., fired=False))
            continue

        await self._dedup.record_fired(clip_job.area_id, scored.signal_id)

        if scored.action == "statistic":
            await self._store.upsert_stat(clip_job.area_id, scored.signal_id,
                                           datetime.now(UTC), scored.score)

        elif scored.action in ("notify", "alarm"):
            clip_path = None
            if frame_set and self._clip_store:
                clip_path = str(self._clip_store.save(clip_job.clip_path, event_id, clip_job.area_id))

            llm_verdict = None
            if scored.signal.escalation_llm and self._llm_client:
                try:
                    llm_verdict = await self._llm_client.analyze(
                        frame_set.frames_llm, scored.signal.llm_prompt_key
                    )
                except Exception as e:
                    log.warning("llm_escalation_failed", error=str(e))
                    # alert prosegue senza verdict — PRD §8.2

            event = Event(...)
            await self._store.save_event(event)

            payload = AlertPayload(...)
            if scored.action == "alarm":
                await self._notifier.send_priority(payload)
            else:
                await self._notifier.send(payload)

        results.append(ActionResult(..., fired=True, llm_escalation=llm_verdict is not None))
    return results
```

## `tests/test_output.py`

```python
pytestmark = pytest.mark.asyncio

# Test 1: webhook mock riceve payload corretto
async def test_notifier_send(aiohttp_server):
    """Usa aiohttp test server come mock webhook"""
    received = []

    async def handler(request):
        body = await request.json()
        received.append(body)
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

# Test 2: send_priority aggiunge header X-VSA-Priority
async def test_notifier_send_priority_header(aiohttp_server):
    headers_received = {}

    async def handler(request):
        headers_received.update(dict(request.headers))
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    notifier = Notifier(f"http://localhost:{server.port}/webhook")
    ok = await notifier.send_priority(make_alert_payload(action="alarm"))

    assert ok is True
    assert headers_received.get("X-Vsa-Priority") == "critical"

# Test 3: webhook non disponibile → ritorna False, no eccezione
async def test_notifier_unavailable():
    notifier = Notifier("http://localhost:19999/webhook", timeout=1.0)
    ok = await notifier.send(make_alert_payload())
    assert ok is False

# Test 4: webhook 500 → ritorna False
async def test_notifier_server_error(aiohttp_server):
    async def handler(request):
        return web.Response(status=500)

    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    notifier = Notifier(f"http://localhost:{server.port}/webhook")
    ok = await notifier.send(make_alert_payload())
    assert ok is False

# Test 5: ActionRouter completo — notify emette alert e salva evento
async def test_action_router_notify(tmp_path, aiohttp_server):
    received = []

    async def handler(request):
        received.append(await request.json())
        return web.Response(status=200)

    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    store = LanceDBStore(tmp_path / "db")
    await store.initialize()
    clip_store = ClipStore(tmp_path / "storage", tmp_path / "temp")
    notifier = Notifier(f"http://localhost:{server.port}/webhook")
    dedup = AlertDedup()
    router = ActionRouter(dedup, store, notifier, clip_store, llm_client=None)

    from engine.config.models import Signal, AreaSignal
    signal = Signal(id="smoking", text="persona che fuma", priority=2, default_action="notify")
    as_ = AreaSignal(signal_id="smoking")
    scored = ScoredSignal(signal_id="smoking", score=0.75, threshold=0.52,
                           action="notify", exceeds_threshold=True, area_signal=as_, signal=signal)

    clip_job = make_clip_job(area_id="lobby", clip_path=tmp_path / "temp" / "clip.mp4")
    (tmp_path / "temp").mkdir(exist_ok=True)
    clip_job.clip_path.write_bytes(b"fake mp4")

    area_cfg = SimpleNamespace(id="lobby", name="Lobby", alert_cooldown_sec=300)
    results = await router.route([scored], clip_job, None, 300, area_cfg)

    assert results[0].fired is True
    assert len(received) == 1
    assert received[0]["signal_id"] == "smoking"

    # Evento salvato in LanceDB
    events = await store.get_events(area_id="lobby")
    assert len(events) == 1

# Test 6: cooldown blocca secondo alert nella stessa sessione — AC-03
async def test_action_router_cooldown(tmp_path, aiohttp_server):
    received = []
    async def handler(request):
        received.append(await request.json())
        return web.Response(status=200)
    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    store = LanceDBStore(tmp_path / "db")
    await store.initialize()
    notifier = Notifier(f"http://localhost:{server.port}/webhook")
    dedup = AlertDedup()
    router = ActionRouter(dedup, store, notifier, ClipStore(tmp_path/"s", tmp_path/"t"), None)

    signal = Signal(id="s", text="t", priority=2, default_action="notify", cooldown_sec=300)
    as_ = AreaSignal(signal_id="s")
    scored = ScoredSignal("s", 0.7, 0.5, "notify", True, as_, signal)
    job = make_clip_job()

    await router.route([scored], job, None, 300, SimpleNamespace(id="a", name="A", alert_cooldown_sec=300))
    await router.route([scored], job, None, 300, SimpleNamespace(id="a", name="A", alert_cooldown_sec=300))

    assert len(received) == 1   # secondo alert bloccato da cooldown

# Test 7: LLM non disponibile → alert inviato comunque — PRD §8.2
async def test_action_router_llm_degraded(tmp_path, aiohttp_server):
    received = []
    async def handler(request):
        received.append(await request.json())
        return web.Response(status=200)
    app = web.Application()
    app.router.add_post("/webhook", handler)
    server = await aiohttp_server(app)

    store = LanceDBStore(tmp_path / "db")
    await store.initialize()
    notifier = Notifier(f"http://localhost:{server.port}/webhook")

    # LLM client che sempre fallisce
    failing_llm = AsyncMock(side_effect=Exception("LLM down"))
    failing_llm.analyze = AsyncMock(side_effect=Exception("LLM down"))

    router = ActionRouter(AlertDedup(), store, notifier,
                          ClipStore(tmp_path/"s", tmp_path/"t"), failing_llm)

    signal = Signal(id="smoking2", text="t", default_action="notify", escalation_llm=True)
    as_ = AreaSignal(signal_id="smoking2")
    scored = ScoredSignal("smoking2", 0.7, 0.5, "notify", True, as_, signal)
    job = make_clip_job()
    area = SimpleNamespace(id="lobby", name="Lobby", alert_cooldown_sec=300)

    results = await router.route([scored], job, make_frame_set(), 300, area)

    assert results[0].fired is True          # alert inviato
    assert results[0].llm_escalation is False  # LLM non ha contribuito
    assert len(received) == 1               # webhook chiamato
    assert received[0].get("llm_verdict") is None
```

### Esecuzione test
```bash
source .venv/bin/activate
pip install pytest-aiohttp

pytest tests/test_output.py -v
```

## Criteri di accettazione

- Webhook riceve payload JSON strutturato correttamente
- `send_priority` aggiunge header `X-VSA-Priority: critical`
- Webhook non disponibile → `False`, nessuna eccezione
- Cooldown blocca secondo alert entro `cooldown_sec` — AC-03
- LLM non disponibile: alert inviato senza verdict, loggato come `degraded` — PRD §8.2

## Dipendenze

- Step 07 (ActionRouter stub), Step 08 (LLMVisionClient), Step 09 (LanceDB + ClipStore)
