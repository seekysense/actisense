"""Synchronous LanceDB reader executed in a thread executor."""
from __future__ import annotations

import asyncio
from datetime import datetime


def _serialize_row(row: dict) -> dict:
    result = {}
    for k, v in row.items():
        if k == "embedding":
            continue
        if hasattr(v, "isoformat"):
            result[k] = v.isoformat()
        elif hasattr(v, "item"):
            result[k] = v.item()
        else:
            result[k] = v
    return result


class LanceDBReader:
    def __init__(self, db_path: str):
        self._path = db_path
        self._db = None

    def _connect(self):
        if self._db is None:
            import lancedb
            self._db = lancedb.connect(self._path)
        return self._db

    async def get_events(
        self,
        area_id: str | None = None,
        signal_id: str | None = None,
        limit: int = 100,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[dict]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._get_events_sync, area_id, signal_id, limit, since, until
        )

    def _get_events_sync(self, area_id, signal_id, limit, since, until) -> list[dict]:
        try:
            db = self._connect()
            table = db.open_table("events")
            q = table.search()
            filters = []
            if area_id:
                filters.append(f"area_id = '{area_id}'")
            if signal_id:
                filters.append(f"signal_id = '{signal_id}'")
            if since:
                since_str = since.strftime("%Y-%m-%dT%H:%M:%S.000Z")
                filters.append(f"timestamp >= timestamp '{since_str}'")
            if until:
                until_str = until.strftime("%Y-%m-%dT%H:%M:%S.000Z")
                filters.append(f"timestamp <= timestamp '{until_str}'")
            if filters:
                q = q.where(" AND ".join(filters))
            rows = q.limit(limit).to_list()
            return [_serialize_row(r) for r in rows]
        except Exception:
            return []

    async def get_event_by_id(self, event_id: str) -> dict | None:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_event_by_id_sync, event_id)

    def _get_event_by_id_sync(self, event_id: str) -> dict | None:
        try:
            db = self._connect()
            table = db.open_table("events")
            rows = table.search().where(f"event_id = '{event_id}'").limit(1).to_list()
            return _serialize_row(rows[0]) if rows else None
        except Exception:
            return None

    async def get_stats(
        self,
        area_id: str | None = None,
        date: str | None = None,
    ) -> list[dict]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_stats_sync, area_id, date)

    def _get_stats_sync(self, area_id, date) -> list[dict]:
        try:
            db = self._connect()
            table = db.open_table("stats")
            q = table.search()
            filters = []
            if area_id:
                filters.append(f"area_id = '{area_id}'")
            if date:
                filters.append(f"date = '{date}'")
            if filters:
                q = q.where(" AND ".join(filters))
            return q.to_list()
        except Exception:
            return []
