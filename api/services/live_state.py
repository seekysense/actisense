"""In-memory store for engine live state: heartbeat (queue + cameras) and activity log."""
from __future__ import annotations

import time
from collections import deque


class LiveState:
    def __init__(self, max_activity: int = 100) -> None:
        self._queue: dict | None = None
        self._cameras: dict[str, dict] = {}
        self._activity: deque[dict] = deque(maxlen=max_activity)
        self._pending_summary: dict = {}

    def update_heartbeat(self, data: dict) -> None:
        cameras = data.pop("cameras", [])
        self._pending_summary = {
            "pending_by_camera": data.pop("pending_by_camera", {}),
            "pending_by_area": data.pop("pending_by_area", {}),
            "current_jobs": data.pop("current_jobs", []),
        }
        self._queue = {**data, "_ts": time.time()}
        for cam in cameras:
            self._cameras[cam["camera_id"]] = {**cam, "_ts": time.time()}

    def add_activity(self, event: dict) -> None:
        self._activity.appendleft(event)

    def get_status(self) -> dict:
        return {
            "queue": self._queue,
            "cameras": dict(self._cameras),
            "activity": list(self._activity)[:50],
            "pending_summary": self._pending_summary,
            "server_ts": time.time(),
        }

    def get_activity(self, limit: int = 100) -> list[dict]:
        return list(self._activity)[:limit]

    def get_queue_detail(self) -> dict:
        return {
            "pending_by_camera": self._pending_summary.get("pending_by_camera", {}),
            "pending_by_area": self._pending_summary.get("pending_by_area", {}),
            "current_jobs": self._pending_summary.get("current_jobs", []),
            "server_ts": time.time(),
        }


live_state = LiveState()
