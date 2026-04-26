# Step 09 — LanceDB storage + clip store

## Obiettivo

Implementare `engine/storage/lancedb_store.py` e `engine/storage/clip_store.py`: schema tabelle, write/read eventi, upsert statistiche aggregate, salvataggio clip su disco.

## File da implementare

```
engine/storage/
├── lancedb_store.py   # tabelle events + stats + operazioni CRUD
└── clip_store.py      # salvataggio clip, path builder, cleanup

tests/
└── test_storage.py
```

## `engine/storage/lancedb_store.py`

### Schema tabella `events`
```python
import pyarrow as pa

EVENTS_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),         # uuid4
    pa.field("area_id", pa.string()),
    pa.field("signal_id", pa.string()),
    pa.field("camera_id", pa.string()),
    pa.field("timestamp", pa.timestamp("ms", tz="UTC")),
    pa.field("score", pa.float32()),
    pa.field("action", pa.string()),           # statistic | notify | alarm
    pa.field("llm_verdict_confirmed", pa.bool_()),
    pa.field("llm_verdict_description", pa.string()),
    pa.field("llm_verdict_confidence", pa.float32()),
    pa.field("clip_path", pa.string()),
    pa.field("embedding", pa.list_(pa.float32(), 512)),  # per future query vettoriali
])
```

### Schema tabella `stats`
```python
STATS_SCHEMA = pa.schema([
    pa.field("area_id", pa.string()),
    pa.field("signal_id", pa.string()),
    pa.field("date", pa.string()),            # "YYYY-MM-DD"
    pa.field("hour_bucket", pa.int8()),       # 0-23
    pa.field("count", pa.int32()),
    pa.field("max_score", pa.float32()),
    pa.field("avg_score", pa.float32()),
])
```

### `LanceDBStore`
```python
class LanceDBStore:
    def __init__(self, db_path: Path): ...

    async def initialize(self) -> None:
        """Crea tabelle se non esistono. Idempotente."""

    async def save_event(self, event: Event) -> None:
        """Insert in tabella events."""

    async def upsert_stat(
        self,
        area_id: str,
        signal_id: str,
        timestamp: datetime,
        score: float,
    ) -> None:
        """
        Upsert stat per (area_id, signal_id, date, hour_bucket).
        Se riga esiste: count += 1, aggiorna max_score e ricalcola avg_score.
        Se non esiste: insert con count=1.
        """

    async def get_events(
        self,
        area_id: str | None = None,
        signal_id: str | None = None,
        limit: int = 100,
        since: datetime | None = None,
    ) -> list[dict]: ...

    async def get_stats(
        self,
        area_id: str | None = None,
        date: str | None = None,
    ) -> list[dict]: ...
```

### `Event` dataclass
```python
@dataclass
class Event:
    event_id: str           # uuid4()
    area_id: str
    signal_id: str
    camera_id: str
    timestamp: datetime
    score: float
    action: str
    clip_path: str
    embedding: list[float]
    llm_verdict: "LLMVerdict | None" = None
```

### Note implementative
- Usare `lancedb.connect()` sincrono + `asyncio.get_event_loop().run_in_executor(None, ...)` per non bloccare l'event loop
- Indicizzazione IVF_PQ su `embedding` da creare **dopo** inserimento ≥ 256 righe (requisito LanceDB)
- Upsert stats: query `WHERE area_id=? AND signal_id=? AND date=? AND hour_bucket=?` + merge

## `engine/storage/clip_store.py`

```python
class ClipStore:
    def __init__(self, storage_dir: Path, temp_dir: Path): ...

    def save(self, temp_path: Path, event_id: str, area_id: str) -> Path:
        """
        Sposta clip da temp_dir a storage_dir.
        Path: storage_dir / area_id / YYYY-MM-DD / {event_id}.mp4
        Ritorna il path finale.
        """

    def cleanup_temp(self, path: Path) -> None:
        """Elimina file da temp_dir se esiste."""

    def get_path(self, event_id: str, area_id: str, timestamp: datetime) -> Path:
        """Ricostruisce path senza file system access."""
```

## `tests/test_storage.py`

```python
pytestmark = pytest.mark.asyncio

@pytest.fixture
async def store(tmp_path):
    s = LanceDBStore(tmp_path / "lancedb")
    await s.initialize()
    return s

# Test 1: initialize idempotente — due chiamate non crashano
async def test_initialize_idempotent(tmp_path):
    s = LanceDBStore(tmp_path / "lancedb")
    await s.initialize()
    await s.initialize()   # seconda chiamata non deve errare

# Test 2: save_event e get_events
async def test_save_and_retrieve_event(store):
    evt = make_event(area_id="lobby", signal_id="smoking", score=0.72)
    await store.save_event(evt)
    events = await store.get_events(area_id="lobby")
    assert len(events) >= 1
    assert events[0]["signal_id"] == "smoking"
    assert abs(events[0]["score"] - 0.72) < 0.01

# Test 3: upsert_stat — stessa (area, signal, date, hour) incrementa count
async def test_upsert_stat_increments(store):
    ts = datetime(2025, 1, 15, 14, 30, tzinfo=timezone.utc)
    await store.upsert_stat("lobby", "smoking", ts, 0.6)
    await store.upsert_stat("lobby", "smoking", ts, 0.8)
    stats = await store.get_stats(area_id="lobby")
    row = next(s for s in stats if s["signal_id"] == "smoking" and s["hour_bucket"] == 14)
    assert row["count"] == 2
    assert abs(row["max_score"] - 0.8) < 0.01

# Test 4: upsert_stat — avg_score corretto
async def test_upsert_stat_avg(store):
    ts = datetime(2025, 1, 15, 10, 0, tzinfo=timezone.utc)
    await store.upsert_stat("pool", "fire_smoke", ts, 0.6)
    await store.upsert_stat("pool", "fire_smoke", ts, 0.8)
    stats = await store.get_stats(area_id="pool")
    row = next(s for s in stats if s["signal_id"] == "fire_smoke")
    assert abs(row["avg_score"] - 0.7) < 0.01   # (0.6 + 0.8) / 2

# Test 5: get_events con filtro since
async def test_get_events_since_filter(store):
    now = datetime.now(timezone.utc)
    evt_old = make_event(timestamp=now - timedelta(hours=2))
    evt_new = make_event(timestamp=now - timedelta(minutes=5))
    await store.save_event(evt_old)
    await store.save_event(evt_new)
    recent = await store.get_events(since=now - timedelta(hours=1))
    assert all(e["timestamp"] >= (now - timedelta(hours=1)) for e in recent)

# Test 6: get_events con limit
async def test_get_events_limit(store):
    for i in range(5):
        await store.save_event(make_event(signal_id=f"s{i}"))
    events = await store.get_events(limit=3)
    assert len(events) <= 3

# Test 7: save_event con llm_verdict
async def test_save_event_with_verdict(store):
    from engine.intelligence.llm_vision_client import LLMVerdict
    verdict = LLMVerdict(confirmed=True, description="persona a terra", confidence=0.92,
                          raw_response="", model_used="test", latency_ms=100)
    evt = make_event(llm_verdict=verdict)
    await store.save_event(evt)
    events = await store.get_events()
    assert events[0]["llm_verdict_confirmed"] is True
    assert events[0]["llm_verdict_confidence"] > 0.9

# Test 8: ClipStore.save sposta file in path corretto
def test_clip_store_save(tmp_path):
    temp = tmp_path / "temp"
    storage = tmp_path / "storage"
    temp.mkdir()
    clip_store = ClipStore(storage, temp)

    clip_file = temp / "test_clip.mp4"
    clip_file.write_bytes(b"fake mp4 data")

    event_id = "evt_abc123"
    area_id = "lobby"
    final_path = clip_store.save(clip_file, event_id, area_id)

    assert final_path.exists()
    assert area_id in str(final_path)
    assert "evt_abc123.mp4" in str(final_path)
    assert not clip_file.exists()   # spostato, non copiato

# Test 9: 24h statistiche aggregate — AC-07
async def test_stats_24h_aggregate(store):
    """Inserisce eventi simulati su 24 ore e verifica aggregazione per hour_bucket"""
    base = datetime(2025, 4, 23, 0, 0, tzinfo=timezone.utc)
    for hour in range(24):
        for _ in range(3):  # 3 eventi per ora
            ts = base + timedelta(hours=hour, minutes=15)
            await store.upsert_stat("lobby", "person_count_stat", ts, 0.5)

    stats = await store.get_stats(area_id="lobby", date="2025-04-23")
    hour_buckets = {s["hour_bucket"] for s in stats}
    assert len(hour_buckets) == 24
    for s in stats:
        assert s["count"] == 3
```

### Helper
```python
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
```

### Esecuzione test
```bash
source .venv/bin/activate
pytest tests/test_storage.py -v
```

## Criteri di accettazione

- `save_event` + `get_events` roundtrip corretto
- `upsert_stat` incrementa count e aggiorna max/avg
- Statistiche 24h su dataset simulato — AC-07
- `ClipStore.save` sposta file in path strutturato
- `initialize` idempotente (run multipli non crashano)

## Dipendenze

- Step 01, 02, 08 completati
- Nessun servizio esterno (LanceDB locale)
