"""In-memory store for engine live state: heartbeat (queue + cameras) and activity log."""
from __future__ import annotations

import time
from collections import deque


class LiveState:
    def __init__(self, max_activity: int = 100) -> None:
        self._queue: dict | None = None
        self._cameras: dict[str, dict] = {}
        self._activity: deque[dict] = deque(maxlen=max_activity)

    def update_heartbeat(self, data: dict) -> None:
        cameras = data.pop("cameras", [])
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
            "server_ts": time.time(),
        }


live_state = LiveState()
