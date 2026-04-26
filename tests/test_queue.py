"""Test suite per engine/queue/ — Step 06."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from engine.queue.priority_queue import ClipJob, ClipQueue


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def make_job(priority: int, path: str) -> ClipJob:
    return ClipJob(
        clip_path=Path(path),
        camera_id="cam_test",
        area_id="lobby",
        recording_id=path.replace(".mp4", ""),
        enqueued_at=time.monotonic(),
        priority=priority,
    )


# ---------------------------------------------------------------------------
# Test 01 — priorità rispettata: job priority=1 prima di priority=3
# ---------------------------------------------------------------------------

async def test_priority_ordering() -> None:
    processed: list[int] = []

    async def processor(job: ClipJob) -> None:
        processed.append(job.priority)
        await asyncio.sleep(0.01)

    q = ClipQueue(max_workers=1, max_depth=100, processor=processor)
    await q.enqueue(make_job(priority=3, path="clip_low.mp4"))
    await q.enqueue(make_job(priority=1, path="clip_high.mp4"))
    await q.enqueue(make_job(priority=2, path="clip_mid.mp4"))

    task = asyncio.create_task(q.start())
    await asyncio.sleep(0.2)
    await q.stop()
    task.cancel()

    assert processed == [1, 2, 3]


# ---------------------------------------------------------------------------
# Test 02 — FIFO a pari priorità
# ---------------------------------------------------------------------------

async def test_fifo_same_priority() -> None:
    processed: list[str] = []

    async def processor(job: ClipJob) -> None:
        processed.append(job.clip_path.name)

    q = ClipQueue(max_workers=1, max_depth=100, processor=processor)
    for i in range(3):
        await asyncio.sleep(0.001)
        await q.enqueue(make_job(priority=2, path=f"clip_{i}.mp4"))

    task = asyncio.create_task(q.start())
    await asyncio.sleep(0.2)
    await q.stop()
    task.cancel()

    assert processed == ["clip_0.mp4", "clip_1.mp4", "clip_2.mp4"]


# ---------------------------------------------------------------------------
# Test 03 — backpressure: job priority >= 4 scartato se coda piena
# ---------------------------------------------------------------------------

async def test_backpressure_drop_low_priority() -> None:
    async def slow_processor(job: ClipJob) -> None:
        await asyncio.sleep(10)

    q = ClipQueue(max_workers=1, max_depth=3, processor=slow_processor)
    task = asyncio.create_task(q.start())
    await asyncio.sleep(0.01)   # avvia worker

    for i in range(3):
        await q.enqueue(make_job(priority=1, path=f"high_{i}.mp4"))

    result = await q.enqueue(make_job(priority=4, path="low.mp4"))
    assert result is False

    result2 = await q.enqueue(make_job(priority=1, path="high_extra.mp4"))
    assert result2 is True   # priorità alta non viene mai scartata

    await q.stop()
    task.cancel()


# ---------------------------------------------------------------------------
# Test 04 — job priority 1–3 non scartato anche se coda piena
# ---------------------------------------------------------------------------

async def test_backpressure_keep_high_priority() -> None:
    async def slow_processor(job: ClipJob) -> None:
        await asyncio.sleep(10)

    q = ClipQueue(max_workers=1, max_depth=2, processor=slow_processor)
    task = asyncio.create_task(q.start())
    await asyncio.sleep(0.01)

    for i in range(2):
        await q.enqueue(make_job(priority=2, path=f"filler_{i}.mp4"))

    result = await q.enqueue(make_job(priority=1, path="critical.mp4"))
    assert result is True

    result2 = await q.enqueue(make_job(priority=3, path="medium.mp4"))
    assert result2 is True

    await q.stop()
    task.cancel()


# ---------------------------------------------------------------------------
# Test 05 — max_workers worker paralleli
# ---------------------------------------------------------------------------

async def test_parallel_workers() -> None:
    started: list[str] = []
    barrier = asyncio.Event()

    async def blocking_processor(job: ClipJob) -> None:
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


# ---------------------------------------------------------------------------
# Test 06 — stats restituisce valori corretti
# ---------------------------------------------------------------------------

async def test_stats() -> None:
    processed_jobs: list[ClipJob] = []

    async def processor(job: ClipJob) -> None:
        processed_jobs.append(job)

    q = ClipQueue(max_workers=2, max_depth=100, processor=processor)
    task = asyncio.create_task(q.start())

    for i in range(5):
        await q.enqueue(make_job(priority=2, path=f"clip_{i}.mp4"))

    await asyncio.sleep(0.2)
    s = q.stats()
    assert s["processed_count"] == 5
    assert s["dropped_count"] == 0
    assert "avg_latency_ms" in s
    assert s["avg_latency_ms"] >= 0

    await q.stop()
    task.cancel()


# ---------------------------------------------------------------------------
# Test 07 — graceful stop: job in corso completati
# ---------------------------------------------------------------------------

async def test_graceful_stop() -> None:
    completed: list[str] = []

    async def processor(job: ClipJob) -> None:
        await asyncio.sleep(0.05)
        completed.append(job.clip_path.name)

    q = ClipQueue(max_workers=2, max_depth=100, processor=processor)
    task = asyncio.create_task(q.start())

    for i in range(4):
        await q.enqueue(make_job(priority=1, path=f"clip_{i}.mp4"))

    await asyncio.sleep(0.1)
    await q.stop()   # aspetta i job in corso
    task.cancel()

    assert len(completed) >= 2


# ---------------------------------------------------------------------------
# Test 08 — dropped_count incrementato correttamente
# ---------------------------------------------------------------------------

async def test_dropped_count() -> None:
    async def slow_processor(job: ClipJob) -> None:
        await asyncio.sleep(10)

    q = ClipQueue(max_workers=1, max_depth=2, processor=slow_processor)
    task = asyncio.create_task(q.start())
    await asyncio.sleep(0.01)

    await q.enqueue(make_job(priority=1, path="fill_0.mp4"))
    await q.enqueue(make_job(priority=1, path="fill_1.mp4"))
    await q.enqueue(make_job(priority=5, path="drop_0.mp4"))  # scartato
    await q.enqueue(make_job(priority=5, path="drop_1.mp4"))  # scartato

    s = q.stats()
    assert s["dropped_count"] == 2

    await q.stop()
    task.cancel()
