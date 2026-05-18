"""
Interfaccia LanceDB per storage di eventi e statistiche aggregate.
Tabelle: events (embedding + metadata), stats (aggregazione per area/signal/ora).
Upsert stats per (area_id, signal_id, date, hour_bucket).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import lancedb
import pyarrow as pa

if TYPE_CHECKING:
    from engine.intelligence.llm_vision_client import LLMVerdict

# Dimensione vettori embedding — deve corrispondere al modello configurato in EMBEDDING_MODEL.
# Galene/Embedding-Vision (Qwen3-VL-Embedding-2B): 2048 dim.
# Se si cambia modello, eliminare il db LanceDB (data/lancedb/) e ricreare.
EMB_DIM = 2048

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

EVENTS_SCHEMA = pa.schema([
    pa.field("event_id",                 pa.string()),
    pa.field("area_id",                  pa.string()),
    pa.field("signal_id",                pa.string()),
    pa.field("camera_id",                pa.string()),
    pa.field("timestamp",                pa.timestamp("ms", tz="UTC")),
    pa.field("score",                    pa.float32()),
    pa.field("action",                   pa.string()),
    pa.field("llm_verdict_confirmed",    pa.bool_()),
    pa.field("llm_verdict_description",  pa.string()),
    pa.field("llm_verdict_confidence",   pa.float32()),
    pa.field("clip_path",                pa.string()),
    pa.field("embedding",                pa.list_(pa.float32(), EMB_DIM)),
])

STATS_SCHEMA = pa.schema([
    pa.field("area_id",      pa.string()),
    pa.field("signal_id",    pa.string()),
    pa.field("date",         pa.string()),
    pa.field("hour_bucket",  pa.int8()),
    pa.field("count",        pa.int32()),
    pa.field("max_score",    pa.float32()),
    pa.field("avg_score",    pa.float32()),
])


# ---------------------------------------------------------------------------
# Event dataclass
# ---------------------------------------------------------------------------

@dataclass
class Event:
    event_id:    str
    area_id:     str
    signal_id:   str
    camera_id:   str
    timestamp:   datetime
    score:       float
    action:      str
    clip_path:   str
    embedding:   list[float]
    llm_verdict: "LLMVerdict | None" = None


# ---------------------------------------------------------------------------
# LanceDBStore
# ---------------------------------------------------------------------------

class LanceDBStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db: lancedb.AsyncConnection | None = None

    async def _conn(self) -> lancedb.AsyncConnection:
        if self._db is None:
            self._db_path.mkdir(parents=True, exist_ok=True)
            self._db = await lancedb.connect_async(str(self._db_path))
        return self._db

    async def initialize(self) -> None:
        """Crea tabelle se non esistono. Idempotente."""
        db = await self._conn()
        await db.create_table("events", schema=EVENTS_SCHEMA, exist_ok=True)
        await db.create_table("stats",  schema=STATS_SCHEMA,  exist_ok=True)
        log.info("lancedb_initialized", path=str(self._db_path))

    async def save_event(self, event: Event) -> None:
        """Insert in tabella events."""
        db = await self._conn()
        tbl = await db.open_table("events")

        verdict = event.llm_verdict
        batch = pa.table({
            "event_id":               [event.event_id],
            "area_id":                [event.area_id],
            "signal_id":              [event.signal_id],
            "camera_id":              [event.camera_id],
            "timestamp":              pa.array(
                [event.timestamp.astimezone(timezone.utc)],
                type=pa.timestamp("ms", tz="UTC"),
            ),
            "score":                  pa.array([float(event.score)],   type=pa.float32()),
            "action":                 [event.action],
            "llm_verdict_confirmed":  [bool(verdict.confirmed)   if verdict else False],
            "llm_verdict_description":[str(verdict.description)  if verdict else ""],
            "llm_verdict_confidence": pa.array(
                [float(verdict.confidence) if verdict else 0.0],
                type=pa.float32(),
            ),
            "clip_path":              [event.clip_path],
            "embedding":              pa.array(
                [event.embedding],
                type=pa.list_(pa.float32(), EMB_DIM),
            ),
        })
        await tbl.add(batch)
        log.debug("event_saved", event_id=event.event_id, signal_id=event.signal_id)

    async def upsert_stat(
        self,
        area_id: str,
        signal_id: str,
        timestamp: datetime,
        score: float,
    ) -> None:
        """
        Upsert stat per (area_id, signal_id, date, hour_bucket).
        count += 1, aggiorna max_score e ricalcola avg_score.
        """
        db = await self._conn()
        tbl = await db.open_table("stats")

        date_str    = timestamp.strftime("%Y-%m-%d")
        hour_bucket = timestamp.hour
        where = (
            f"area_id = '{area_id}' AND signal_id = '{signal_id}' "
            f"AND date = '{date_str}' AND hour_bucket = {hour_bucket}"
        )

        existing = await tbl.query().where(where).limit(1).to_arrow()

        if existing.num_rows == 0:
            batch = pa.table({
                "area_id":     [area_id],
                "signal_id":   [signal_id],
                "date":        [date_str],
                "hour_bucket": pa.array([hour_bucket], type=pa.int8()),
                "count":       pa.array([1],           type=pa.int32()),
                "max_score":   pa.array([float(score)], type=pa.float32()),
                "avg_score":   pa.array([float(score)], type=pa.float32()),
            })
            await tbl.add(batch)
        else:
            old_count     = int(existing["count"][0].as_py())
            old_max       = float(existing["max_score"][0].as_py())
            old_avg       = float(existing["avg_score"][0].as_py())
            new_count     = old_count + 1
            new_max       = max(old_max, float(score))
            new_avg       = (old_avg * old_count + float(score)) / new_count
            await tbl.update(
                {
                    "count":     new_count,
                    "max_score": new_max,
                    "avg_score": new_avg,
                },
                where=where,
            )

    async def get_events(
        self,
        area_id: str | None = None,
        signal_id: str | None = None,
        limit: int = 100,
        since: datetime | None = None,
    ) -> list[dict]:
        db  = await self._conn()
        tbl = await db.open_table("events")

        conditions: list[str] = []
        if area_id:
            conditions.append(f"area_id = '{area_id}'")
        if signal_id:
            conditions.append(f"signal_id = '{signal_id}'")
        if since:
            since_utc = since.astimezone(timezone.utc)
            since_str = since_utc.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
            conditions.append(f"timestamp > timestamp '{since_str}'")

        q = tbl.query().limit(limit)
        if conditions:
            q = q.where(" AND ".join(conditions))

        arrow = await q.to_arrow()
        return _arrow_to_dicts(arrow)

    async def get_stats(
        self,
        area_id: str | None = None,
        date: str | None = None,
    ) -> list[dict]:
        db  = await self._conn()
        tbl = await db.open_table("stats")

        conditions: list[str] = []
        if area_id:
            conditions.append(f"area_id = '{area_id}'")
        if date:
            conditions.append(f"date = '{date}'")

        q = tbl.query().limit(10_000)
        if conditions:
            q = q.where(" AND ".join(conditions))

        arrow = await q.to_arrow()
        return _arrow_to_dicts(arrow)


def _arrow_to_dicts(table: pa.Table) -> list[dict]:
    """Convert PyArrow Table to list of Python dicts (no pandas needed)."""
    rows: list[dict] = []
    for i in range(table.num_rows):
        row: dict = {}
        for col_name in table.column_names:
            val = table.column(col_name)[i]
            py_val = val.as_py()
            # Convert timestamp to datetime
            if isinstance(py_val, int) and table.schema.field(col_name).type == pa.timestamp("ms", tz="UTC"):
                py_val = datetime.fromtimestamp(py_val / 1000, tz=timezone.utc)
            row[col_name] = py_val
        rows.append(row)
    return rows
