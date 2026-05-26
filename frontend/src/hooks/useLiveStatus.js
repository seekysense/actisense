import { useState, useEffect } from "react";

const BASE_URL = import.meta.env.VITE_API_URL || "";

/**
 * Provides real-time engine state: queue stats, camera heartbeat, activity log.
 *
 * @param {Function} subscribe  - from useAlerts() / useWebSocket(); reuses the existing WS connection
 * @param {boolean}  enabled    - only fetches and subscribes when the panel is open
 */
export function useLiveStatus(subscribe, enabled) {
  const [queue, setQueue] = useState(null);
  const [cameras, setCameras] = useState({});
  const [activity, setActivity] = useState([]);

  // Initial REST fetch for snapshot state
  useEffect(() => {
    if (!enabled) return;
    const token = localStorage.getItem("vsa_token");
    fetch(`${BASE_URL}/api/live/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.queue) setQueue(data.queue);
        if (data.cameras) setCameras(data.cameras);
        if (data.activity) setActivity(data.activity.slice(0, 50));
      })
      .catch(() => {});
  }, [enabled]);

  // WS subscription for incremental updates
  useEffect(() => {
    if (!enabled) return;
    return subscribe((msg) => {
      if (msg.type === "engine_heartbeat") {
        const { cameras: camList, ...queueData } = msg.data;
        setQueue(queueData);
        if (camList?.length) {
          setCameras((prev) => {
            const next = { ...prev };
            for (const cam of camList) next[cam.camera_id] = cam;
            return next;
          });
        }
      }
      if (msg.type === "engine_event") {
        setActivity((prev) => [msg.data, ...prev].slice(0, 50));
      }
    });
  }, [enabled, subscribe]);

  return { queue, cameras, activity };
}
