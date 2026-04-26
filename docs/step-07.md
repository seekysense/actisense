# Step 07 — Signal evaluator + Action router

## Obiettivo

Implementare `engine/intelligence/signal_evaluator.py` e `engine/intelligence/action_router.py`: scoring clip vs Signal attivi, `time_filter`, multi-cam aggregation, cooldown, dispatch `statistic`/`notify`/`alarm`. Testato con embedding reali e video di test.

## File da implementare

```
engine/intelligence/
├── signal_evaluator.py   # cosine scoring, time_filter, multi-cam max
└── action_router.py      # dispatch per action type, cooldown check

engine/output/
└── alert_dedup.py        # cooldown in memoria (usato da action_router)

tests/
└── test_signal_evaluator.py
```

## `engine/output/alert_dedup.py`

Da implementare **prima** di `action_router.py` perché ne dipende.

```python
class AlertDedup:
    """Thread-safe cooldown per (area_id, signal_id)."""

    def __init__(self): ...

    async def should_fire(self, area_id: str, signal_id: str, cooldown_sec: int) -> bool:
        """
        True se l'ultimo alert per questa coppia è più vecchio di cooldown_sec
        o se non è mai stato emesso.
        """

    async def record_fired(self, area_id: str, signal_id: str) -> None:
        """Registra che un alert è stato emesso ora."""

    def reset(self, area_id: str | None = None, signal_id: str | None = None) -> None:
        """Resetta cooldown. Usato in test."""
```

Internamente: `dict[(area_id, signal_id), float]` con `asyncio.Lock`.

## `engine/intelligence/signal_evaluator.py`

### `ScoredSignal` dataclass
```python
@dataclass
class ScoredSignal:
    signal_id: str
    score: float               # max score tra cam della stessa area
    threshold: float           # effective threshold (con override)
    action: str                # effective action (con override)
    exceeds_threshold: bool    # score > threshold
    area_signal: AreaSignal
    signal: Signal
```

### `SignalEvaluator`
```python
class SignalEvaluator:
    def __init__(self, signal_cache: SignalCache): ...

    async def evaluate(
        self,
        video_embeddings: dict[str, list[float]],   # {camera_id: vector}
        area_id: str,
        area_signals: list[tuple[AreaSignal, Signal]],
    ) -> list[ScoredSignal]:
        """
        Per ogni Signal attivo sull'area:
        1. Skip se time_filter attivo e ora fuori range
        2. Skip se Signal.source == 'native_axis' (non passa dall'embedder)
        3. Calcola cosine_similarity(video_embedding_camX, signal_text_embedding) per ogni cam
        4. area_score = max(scores) — multi-cam reinforcement
        5. Restituisce lista ScoredSignal ordinata per score desc
        """
```

### Logica `time_filter`
```python
def _within_time_filter(time_filter: dict | None) -> bool:
    """
    Ritorna True se ora corrente (UTC) è dentro il range {from, to}.
    Gestisce overnight: from="22:00", to="07:00" (from > to)
    """
```

## `engine/intelligence/action_router.py`

### `ActionResult` dataclass
```python
@dataclass
class ActionResult:
    signal_id: str
    action: str          # "statistic" | "notify" | "alarm" | "skipped"
    score: float
    fired: bool          # False se bloccato da cooldown
    llm_escalation: bool
```

### `ActionRouter`
```python
class ActionRouter:
    def __init__(
        self,
        dedup: AlertDedup,
        lancedb_store,       # type hint dopo Step 09
        notifier,            # type hint dopo Step 10
        clip_store,          # type hint dopo Step 09
        llm_client,          # type hint dopo Step 08
    ): ...

    async def route(
        self,
        scored_signals: list[ScoredSignal],
        clip_job: "ClipJob",
        frame_set: "FrameSet",
        area_cooldown_sec: int,
    ) -> list[ActionResult]:
        """
        Per ogni ScoredSignal che exceeds_threshold:
        1. Verifica cooldown via dedup.should_fire()
        2. Se cooldown OK:
           - statistic → lancedb_store.save_stat()
           - notify → notifier.send() + clip_store.save() + LLM se escalation_llm
           - alarm → notifier.send_priority() + clip_store.save() + LLM se escalation_llm
        3. dedup.record_fired()
        """
```

Nel MVP di questo step, `lancedb_store`, `notifier`, `clip_store`, `llm_client` possono essere `None` o mock — verranno integrati negli step successivi.

## `tests/test_signal_evaluator.py`

```python
pytestmark = pytest.mark.asyncio

# Test 1: score supera threshold → exceeds_threshold=True
async def test_score_above_threshold(signal_cache, cfg):
    evaluator = SignalEvaluator(signal_cache)
    area_id = "lobby"
    area_signals = cfg.active_signals_for_area(area_id)

    # Usa embedding reale da video armadio
    from engine.preprocessing.frame_extractor import extract_frames
    from engine.embedding.client import EmbeddingClient
    client = EmbeddingClient(cfg.embedding_service_url)
    fs = extract_frames(Path("video-test/armadio.mp4"), list(cfg.cameras.values())[0], cfg)
    vec = await client.embed_video(fs.frames_embedder)
    embeddings = {"cam_lobby_01": vec}

    results = await evaluator.evaluate(embeddings, area_id, area_signals)
    assert len(results) > 0
    for r in results:
        print(f"  Signal {r.signal_id}: score={r.score:.4f}, threshold={r.threshold}")

# Test 2: time_filter esclude signal fuori orario
async def test_time_filter_excludes(signal_cache):
    """Crea un AreaSignal con time_filter nel passato e verifica che sia escluso"""
    from engine.config.models import Signal, AreaSignal
    signal = Signal(id="test_timed", text="test", time_filter={"from": "01:00", "to": "01:01"})
    as_ = AreaSignal(signal_id="test_timed")
    # Alle 23:xx il signal deve essere escluso
    evaluator = SignalEvaluator(signal_cache)
    # Implementare override ora in test o mockar _within_time_filter
    ...

# Test 3: time_filter overnight (from > to)
def test_time_filter_overnight():
    from engine.intelligence.signal_evaluator import _within_time_filter
    # Range "22:00"-"07:00": alle 23:00 deve essere dentro
    # Mockare datetime.now() a 23:00
    ...

# Test 4: Signal source=native_axis escluso da evaluator
async def test_native_axis_signal_excluded(signal_cache, cfg):
    evaluator = SignalEvaluator(signal_cache)
    area_signals = cfg.active_signals_for_area("lobby")
    native_signals = [as_ for as_, sig in area_signals if sig.source == "native_axis"]
    if not native_signals:
        pytest.skip("Nessun signal native_axis in config lobby")
    vec = [0.0] * 512
    results = await evaluator.evaluate({"cam_test": vec}, "lobby", area_signals)
    result_ids = {r.signal_id for r in results}
    for as_ in native_signals:
        assert as_.signal_id not in result_ids

# Test 5: multi-cam max aggregation
async def test_multicam_max_score(signal_cache):
    from engine.config.models import Signal, AreaSignal
    signal = Signal(id="s1", text="test signal")
    as_ = AreaSignal(signal_id="s1")
    # Pre-carica manualmente embedding nel cache
    signal_cache._cache["s1"] = [1.0] + [0.0] * 511   # vettore unitario dim 0

    evaluator = SignalEvaluator(signal_cache)
    # cam1 score basso, cam2 score alto
    vec_low = [0.3] + [0.0] * 511   # norma 0.3
    vec_high = [0.9] + [0.0] * 511  # norma 0.9
    embeddings = {"cam1": vec_low, "cam2": vec_high}

    results = await evaluator.evaluate(embeddings, "test_area", [(as_, signal)])
    assert len(results) == 1
    assert abs(results[0].score - 0.9) < 0.01   # usa il max, non la media

# Test 6: threshold override AreaSignal
async def test_threshold_override(signal_cache):
    from engine.config.models import Signal, AreaSignal
    signal = Signal(id="s2", text="test", default_threshold=0.8)
    as_ = AreaSignal(signal_id="s2", threshold_override=0.3)

    signal_cache._cache["s2"] = [1.0] + [0.0] * 511

    evaluator = SignalEvaluator(signal_cache)
    vec = [0.5] + [0.0] * 511
    results = await evaluator.evaluate({"cam1": vec}, "area", [(as_, signal)])
    assert results[0].exceeds_threshold is True   # 0.5 > 0.3 (override)

# Test 7: cooldown blocca secondo alert — AC-03
@pytest.mark.asyncio
async def test_cooldown_dedup():
    dedup = AlertDedup()
    # Primo alert → deve passare
    assert await dedup.should_fire("lobby", "smoking", cooldown_sec=300) is True
    await dedup.record_fired("lobby", "smoking")
    # Secondo alert immediato → bloccato
    assert await dedup.should_fire("lobby", "smoking", cooldown_sec=300) is False

# Test 8: cooldown scaduto → alert passa di nuovo
@pytest.mark.asyncio
async def test_cooldown_expired():
    dedup = AlertDedup()
    await dedup.record_fired("lobby", "smoking")
    # Mockare timestamp nel passato (cooldown_sec=0 sovrascrive)
    assert await dedup.should_fire("lobby", "smoking", cooldown_sec=0) is True

# Test 9: ActionRouter dispatcha su statistic senza crash (stub store)
@pytest.mark.asyncio
async def test_action_router_statistic():
    dedup = AlertDedup()
    router = ActionRouter(dedup, None, None, None, None)

    from engine.config.models import Signal, AreaSignal
    signal = Signal(id="s3", text="t", default_action="statistic")
    as_ = AreaSignal(signal_id="s3")
    scored = ScoredSignal(
        signal_id="s3", score=0.6, threshold=0.5, action="statistic",
        exceeds_threshold=True, area_signal=as_, signal=signal
    )
    results = await router.route([scored], make_clip_job(), None, 300)
    assert results[0].action == "statistic"
    assert results[0].fired is True
```

### Esecuzione test
```bash
source .venv/bin/activate
pytest tests/test_signal_evaluator.py -v -s

# Solo unit test (no embedding service)
pytest tests/test_signal_evaluator.py -v -k "threshold or multicam or cooldown or time_filter"
```

## Criteri di accettazione

- Multi-cam usa `max()`, non media — AC-03 prerequisito
- `time_filter` esclude Signal fuori orario — AC-04
- Cooldown blocca alert consecutivi entro `cooldown_sec` — AC-03
- `native_axis` Signal escluso dall'evaluator
- `threshold_override` applicato correttamente

## Dipendenze

- Step 02 (config), Step 04 (embedding), Step 06 (ClipJob dataclass)
- Servizio embedding per test di integrazione
