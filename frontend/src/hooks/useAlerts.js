import { useState, useEffect } from "react";
import { useWebSocket } from "./useWebSocket.js";
import { api } from "../api/client.js";

const WS_URL =
  (import.meta.env.VITE_WS_URL ||
    (typeof window !== "undefined"
      ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
      : "ws://localhost:8000")) + "/api/ws";

export function useAlerts(maxAlerts = 50) {
  const [alerts, setAlerts] = useState([]);
  const { status, subscribe } = useWebSocket(WS_URL);

  useEffect(() => {
    api.getAlerts(20).then(setAlerts).catch(console.error);
  }, []);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "alert") {
        setAlerts((prev) => [msg.data, ...prev].slice(0, maxAlerts));
      }
    });
  }, [subscribe, maxAlerts]);

  return { alerts, wsStatus: status, subscribe };
}
