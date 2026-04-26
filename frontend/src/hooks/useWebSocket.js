import { useEffect, useRef, useState } from "react";

export function useWebSocket(url) {
  const [status, setStatus] = useState("disconnected");
  const wsRef = useRef(null);
  const listenersRef = useRef([]);

  useEffect(() => {
    let stopped = false;

    function connect() {
      if (stopped) return;
      const token = localStorage.getItem("vsa_token");
      const wsUrl = token ? `${url}?token=${token}` : url;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => setStatus("connected");
      ws.onclose = () => {
        setStatus("disconnected");
        if (!stopped) setTimeout(connect, 3000);
      };
      ws.onerror = () => setStatus("error");
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "ping") return;
          listenersRef.current.forEach((cb) => cb(msg));
        } catch (_) {}
      };
    }

    connect();
    return () => {
      stopped = true;
      wsRef.current?.close();
    };
  }, [url]);

  const subscribe = (cb) => {
    listenersRef.current.push(cb);
    return () => {
      listenersRef.current = listenersRef.current.filter((l) => l !== cb);
    };
  };

  return { status, subscribe };
}
