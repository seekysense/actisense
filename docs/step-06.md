# Step 06 — Priority queue + worker pool

## Obiettivo

Implementare `engine/queue/priority_queue.py`: coda asincrona con priorità, pool di worker, backpressure, metriche. Questo è il cuore dello scheduling di elaborazione clip.

## File da implementare

```
engine/queue/
└── priority_queue.py

tests/
└── test_queue.py
```

## `engine/queue/priority_queue.py`

### `ClipJob` dataclass
```python
@dataclass
class ClipJob:
    clip_path: Path
    camera_id: str
    area_id: str
    recording_id: str
    enqueued_at: float    # time.monotonic()
    priority: int         # Signal.priority minimo tra Signal attivi sull'area (1=critico)

    def __lt__(self, other: "ClipJob") -> bool:
        # Tiebreaker FIFO a pari priorità
        if self.priority == other.priority:
            return self.enqueued_at < other.enqueued_at
        return self.priority < other.priority
```

### `ClipQueue`
```python
class ClipQueue:
    def __init__(self, max_workers: int, max_depth: int,
                 processor: Callable[[ClipJob], Awaitable[None]]): ...

    async def enqueue(self, job: ClipJob) -> bool:
        """
        Aggiunge job alla coda.
        Se queue_depth > max_depth E job.priority >= 4: scarta, log warning, ritorna False.
        Altrimenti: inserisce, ritorna True.
        """

    async def start(self) -> None:
        """Avvia max_workers worker asyncio. Blocca fino a stop()."""

    async def stop(self) -> None:
        """Graceful shutdown: attende completamento job in corso."""

    def depth(self) -> int:
        """Numero di job in coda (non in elaborazione)."""

    def stats(self) -> dict:
        """Ritorna: depth, processed_count, dropped_count, avg_latency_ms"""
```

### Worker interno
```python
async def _worker(self) -> None:
    while True:
        priority, enqueued_at, job = await self._queue.get()
        try:
            await self._processor(job)
            self._processed_count += 1
            latency = (time.monotonic() - job.enqueued_at) * 1000
            self._latencies.append(latency)
        except Exception as e:
            log.error("worker_error", job=job.recording_id, error=str(e))
        finally:
            self._queue.task_done()
```

### Metriche log ogni 60s
```python
async def _metrics_loop(self) -> None:
    while not self._stopped:
        await asyncio.sleep(60)
        log.info("queue_metrics", **self.stats())
```

### Uso `asyncio.PriorityQueue`
Gli item nella coda sono tuple `(priority, enqueued_at, job)` — necessario perché `PriorityQueue` non confronta oggetti `ClipJob` direttamente ma la tuple garantisce ordering corretto.

## `tests/test_queue.py`

```python
pytestmark = pytest.mark.asyncio

# Test 1: job priorità 1 elaborato prima di priorità 3 anche se arriva dopo
async def test_priority_ordering():
    processed = []

    async def processor(job: ClipJob):
        processed.append(job.priority)
        await asyncio.sleep(0.01)

    q = ClipQueue(max_workers=1, max_depth=100, processor=processor)
    # Enqueue priorità bassa prima
    await q.enqueue(make_job(priority=3, path="clip_low.mp4"))
    await q.enqueue(make_job(priority=1, path="clip_high.mp4"))
    await q.enqueue(make_job(priority=2, path="clip_mid.mp4"))

    task = asyncio.create_task(q.start())
    await asyncio.sleep(0.2)
    await q.stop()
    task.cancel()

    assert processed == [1, 2, 3]

# Test 2: FIFO a pari priorità
async def test_fifo_same_priority():
    processed = []

    async def processor(job: ClipJob):
        processed.append(job.clip_path.name)

    q = ClipQueue(max_workers=1, max_depth=100, processor=processor)
    for i in range(3):
        await asyncio.sleep(0.001)   # garantisce enqueued_at diverso
        await q.enqueue(make_job(priority=2, path=f"clip_{i}.mp4"))

    task = asyncio.create_task(q.start())
    await asyncio.sleep(0.2)
    await q.stop()
    task.cancel()

    assert processed == ["clip_0.mp4", "clip_1.mp4", "clip_2.mp4"]

# Test 3: backpressure — job priority >= 4 scartato se coda piena
async def test_backpressure_drop_low_priority():
    async def slow_processor(job: ClipJob):
        await asyncio.sleep(10)   # blocca il worker

    q = ClipQueue(max_workers=1, max_depth=3, processor=slow_processor)
    task = asyncio.create_task(q.start())
    await asyncio.sleep(0.01)    # avvia worker

    # Riempi coda con job priorità alta
    for i in range(3):
        await q.enqueue(make_job(priority=1, path=f"high_{i}.mp4"))

    # Tenta enqueue job a bassa priorità con coda piena
    result = await q.enqueue(make_job(priority=4, path="low.mp4"))
    assert result is False

    # Job priorità alta non scartato
    result2 = await q.enqueue(make_job(priority=1, path="high_extra.mp4"))
    assert result2 is True   # forza enqueue anche se sopra max_depth per priorità alta

    await q.stop()
    task.cancel()

# Test 4: job priorità 1–3 non scartato anche se coda piena
async def test_backpressure_keep_high_priority():
    async def slow_processor(job: ClipJob):
        await asyncio.sleep(10)

    q = ClipQueue(max_workers=1, max_depth=2, processor=slow_processor)
    task = asyncio.create_task(q.start())
    await asyncio.sleep(0.01)

    for i in range(2):
        await q.enqueue(make_job(priority=2, path=f"filler_{i}.mp4"))

    result = await q.enqueue(make_job(priority=1, path="critical.mp4"))
    assert result is True   # priorità 1 non viene mai scartato

    await q.stop()
    task.cancel()

# Test 5: max_workers paralleli
async def test_parallel_workers():
    started = []
    barrier = asyncio.Event()

    async def blocking_processor(job: ClipJob):
        started.append(job.clip_path.name)
        await barrier.wait()

    q = ClipQueue(max_workers=3, max_depth=100, processor=blocking_processor)
    task = asyncio.create_task(q.start())

    for i in range(3):
        await q.enqueue(make_job(priority=1, path=f"clip_{i}.mp4"))

    await asyncio.sleep(0.1)
    assert len(started) == 3   # tutti e 3 partiti in parallelo

    barrier.set()
    await q.stop()
    task.cancel()

# Test 6: stats restituisce valori corretti
async def test_stats():
    processed_events = []

    async def processor(job: ClipJob):
        processed_events.append(job)

    q = ClipQueue(max_workers=2, max_depth=100, processor=processor)
    task = asyncio.create_task(q.start())

    for i in range(5):
        await q.enqueue(make_job(priority=2, path=f"clip_{i}.mp4"))

    await asyncio.sleep(0.2)
    s = q.stats()
    assert s["processed_count"] == 5
    assert s["dropped_count"] == 0
    assert "avg_latency_ms" in s

    await q.stop()
    task.cancel()

# Test 7: graceful stop — job in corso completati
async def test_graceful_stop():
    completed = []

    async def processor(job: ClipJob):
        await asyncio.sleep(0.05)
        completed.append(job.clip_path.name)

    q = ClipQueue(max_workers=2, max_depth=100, processor=processor)
    task = asyncio.create_task(q.start())

    for i in range(4):
        await q.enqueue(make_job(priority=1, path=f"clip_{i}.mp4"))

    await asyncio.sleep(0.1)
    await q.stop()   # deve aspettare i job in corso
    task.cancel()

    assert len(completed) >= 2   # almeno i 2 job partiti sono completati
```

### Helper fixture
```python
def make_job(priority: int, path: str) -> ClipJob:
    return ClipJob(
        clip_path=Path(path),
        camera_id="cam_test",
        area_id="lobby",
        recording_id=path.replace(".mp4", ""),
        enqueued_at=time.monotonic(),
        priority=priority,
    )
```

### Esecuzione test
```bash
source .venv/bin/activate
pytest tests/test_queue.py -v
```

## Criteri di accettazione

- Priorità rispettata: job priority=1 precede priority=3
- FIFO a pari priorità
- Backpressure: job priority ≥ 4 scartato con coda piena, log warning
- `QUEUE_MAX_WORKERS` worker paralleli attivi
- Graceful stop aspetta completamento job in corso
- Metriche disponibili via `stats()`

## Dipendenze

- Step 01 completato
- Nessun servizio esterno richiesto (unit test puri)
