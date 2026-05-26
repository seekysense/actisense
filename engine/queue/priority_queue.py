"""
Wrapper asyncio.PriorityQueue con pool di worker.
Priorità = Signal.priority minimo sull'area (1=critico).
Backpressure: scarta job priority>=4 se coda >= QUEUE_MAX_DEPTH.
"""
from __future__ import annotations

import asyncio
import itertools
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


@dataclass
class ClipJob:
    clip_path: Path
    camera_id: str
    area_id: str
    recording_id: str
    enqueued_at: float   # time.monotonic() — usato per calcolo latency
    priority: int        # 1=critico … 5=informational
    disk_id: str = ""    # Axis disk_id (es. "SD_DISK"), usato in CLIP_ON_CAMERA mode

    def __lt__(self, other: "ClipJob") -> bool:
        if self.priority == other.priority:
            return self.enqueued_at < other.enqueued_at
        return self.priority < other.priority


class ClipQueue:
    """
    Coda asincrona a priorità con pool di worker e backpressure.

    Internamente usa tuple (priority, seq, job) per garantire:
    - ordering per priorità
    - FIFO a pari priorità (seq monotonicamente crescente)
    - nessun confronto diretto tra oggetti ClipJob
    """

    def __init__(
        self,
        max_workers: int,
        max_depth: int,
        processor: Callable[[ClipJob], Awaitable[None]],
    ) -> None:
        self._max_workers = max_workers
        self._max_depth = max_depth
        self._processor = processor
        self._queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        self._seq = itertools.count(1)    # garantisce unicità tiebreaker
        self._processed_count = 0
        self._dropped_count = 0
        self._active_workers = 0
        self._latencies: list[float] = []
        self._stopped = False
        self._stop_event: asyncio.Event | None = None
        self._worker_tasks: list[asyncio.Task] = []
        self._metrics_task: asyncio.Task | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def enqueue(self, job: ClipJob) -> bool:
        """
        Aggiunge job alla coda.
        Se depth >= max_depth e priority >= 4: scarta (backpressure).
        Job con priority 1-3 non vengono mai scartati.
        """
        if self._queue.qsize() >= self._max_depth and job.priority >= 4:
            self._dropped_count += 1
            log.warning("job_dropped_backpressure",
                        recording_id=job.recording_id,
                        priority=job.priority,
                        depth=self._queue.qsize(),
                        max_depth=self._max_depth)
            return False
        self._queue.put_nowait((job.priority, next(self._seq), job))
        return True

    async def start(self) -> None:
        """Avvia max_workers worker asyncio. Blocca fino a stop()."""
        self._stopped = False
        self._stop_event = asyncio.Event()
        self._worker_tasks = [
            asyncio.create_task(self._worker()) for _ in range(self._max_workers)
        ]
        self._metrics_task = asyncio.create_task(self._metrics_loop())
        await self._stop_event.wait()

    async def stop(self) -> None:
        """Graceful shutdown: attende completamento job in corso."""
        self._stopped = True
        # Sentinel con priority 0 (< qualsiasi job reale) per sbloccare i worker
        for _ in range(self._max_workers):
            self._queue.put_nowait((0, next(self._seq), None))
        # Aspetta che tutti i worker terminino (inclusi job in-flight)
        if self._worker_tasks:
            await asyncio.gather(*self._worker_tasks, return_exceptions=True)
        if self._metrics_task:
            self._metrics_task.cancel()
            try:
                await self._metrics_task
            except asyncio.CancelledError:
                pass
        if self._stop_event:
            self._stop_event.set()

    def depth(self) -> int:
        """Numero di job in coda (non in elaborazione)."""
        return self._queue.qsize()

    def stats(self) -> dict:
        """Ritorna metriche operative della coda."""
        avg = (sum(self._latencies) / len(self._latencies)) if self._latencies else 0.0
        return {
            "queue_depth": self.depth(),
            "processed_count": self._processed_count,
            "dropped_count": self._dropped_count,
            "avg_latency_ms": round(avg, 2),
            "workers_busy": self._active_workers,
            "max_workers": self._max_workers,
        }

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _worker(self) -> None:
        while True:
            _, _, job = await self._queue.get()
            if job is None:          # sentinel → shutdown
                self._queue.task_done()
                break
            self._active_workers += 1
            try:
                await self._processor(job)
                self._processed_count += 1
                latency = (time.monotonic() - job.enqueued_at) * 1000
                self._latencies.append(latency)
            except Exception as exc:
                log.error("worker_error", recording_id=job.recording_id, error=str(exc))
            finally:
                self._active_workers -= 1
                self._queue.task_done()

    async def _metrics_loop(self) -> None:
        while not self._stopped:
            await asyncio.sleep(60)
            if not self._stopped:
                log.info("queue_metrics", **self.stats())
