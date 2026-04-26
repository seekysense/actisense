# Step 13 — React frontend dashboard

## Obiettivo

Implementare il frontend React: dashboard real-time con lista alert, grafico statistiche per area, pannello configurazione read-only. 
Acquisisci il design fatto con Claude Design  su /design
Il risultato finale deve essere più simile possibile a quel design in termini di componenti, disposizioni e colori.
Il frontend deve essere connesso al backend **Python FastAPI** (porta 8000) via REST + WebSocket.

## File da implementare

```
frontend/src/
├── api/
│   └── client.js           # REST client per FastAPI backend
├── hooks/
│   ├── useAlerts.js        # hook WebSocket + buffer alert
│   └── useWebSocket.js     # WebSocket connection manager
├── components/
│   ├── AlertList.jsx        # lista alert in real-time
│   ├── AlertCard.jsx        # card singolo alert
│   ├── StatsChart.jsx       # recharts bar chart per area/ora
│   ├── SignalBadge.jsx      # badge colorato per priority
│   └── ConnectionStatus.jsx # stato WebSocket
├── pages/
│   ├── Dashboard.jsx        # home: AlertList + StatsChart
│   ├── Events.jsx           # storico eventi da LanceDB
│   └── Config.jsx           # config read-only (aree, signal, cam)
├── App.jsx
├── main.jsx
└── index.css
```

## `frontend/src/api/client.js`

```javascript
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const api = {
  async getAlerts(limit = 20) {
    const res = await fetch(`${BASE_URL}/api/alerts?limit=${limit}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async getEvents({ areaId, signalId, limit = 100, since } = {}) {
    const params = new URLSearchParams();
    if (areaId) params.set("area_id", areaId);
    if (signalId) params.set("signal_id", signalId);
    if (limit) params.set("limit", limit);
    if (since) params.set("since", since.toISOString());
    const res = await fetch(`${BASE_URL}/api/events?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async getStats({ areaId, date } = {}) {
    const params = new URLSearchParams();
    if (areaId) params.set("area_id", areaId);
    if (date) params.set("date", date);
    const res = await fetch(`${BASE_URL}/api/stats?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async getConfig() {
    const res = await fetch(`${BASE_URL}/api/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};
```

## `frontend/src/hooks/useWebSocket.js`

```javascript
import { useEffect, useRef, useState } from "react";

export function useWebSocket(url) {
  const [status, setStatus] = useState("disconnected");
  const wsRef = useRef(null);
  const listenersRef = useRef([]);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => setStatus("connected");
      ws.onclose = () => {
        setStatus("disconnected");
        setTimeout(connect, 3000);   // riconnessione automatica
      };
      ws.onerror = () => setStatus("error");
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "ping") return;   // keepalive dal server
        listenersRef.current.forEach(cb => cb(msg));
      };
    }
    connect();
    return () => wsRef.current?.close();
  }, [url]);

  const subscribe = (cb) => {
    listenersRef.current.push(cb);
    return () => {
      listenersRef.current = listenersRef.current.filter(l => l !== cb);
    };
  };

  return { status, subscribe };
}
```

## `frontend/src/hooks/useAlerts.js`

```javascript
import { useState, useEffect } from "react";
import { useWebSocket } from "./useWebSocket.js";
import { api } from "../api/client.js";

const WS_URL = (import.meta.env.VITE_WS_URL || "ws://localhost:8000") + "/api/ws";

export function useAlerts(maxAlerts = 50) {
  const [alerts, setAlerts] = useState([]);
  const { status, subscribe } = useWebSocket(WS_URL);

  useEffect(() => {
    api.getAlerts(20).then(data => setAlerts(data)).catch(console.error);
  }, []);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "alert") {
        setAlerts(prev => [msg.data, ...prev].slice(0, maxAlerts));
      }
    });
  }, [subscribe, maxAlerts]);

  return { alerts, wsStatus: status };
}
```

## `frontend/src/components/SignalBadge.jsx`

```jsx
const PRIORITY_COLORS = {
  1: "#ef4444",   // critico — rosso
  2: "#f59e0b",   // alto — arancio
  3: "#3b82f6",   // medio — blu
  4: "#6b7280",   // basso — grigio
  5: "#9ca3af",   // info — grigio chiaro
};

export function SignalBadge({ priority, signalId }) {
  const color = PRIORITY_COLORS[priority] || "#6b7280";
  return (
    <span style={{ background: color, color: "#fff", padding: "2px 8px",
                   borderRadius: "12px", fontSize: "0.8em", fontWeight: "bold" }}>
      P{priority} {signalId}
    </span>
  );
}
```

## `frontend/src/components/ConnectionStatus.jsx`

```jsx
export function ConnectionStatus({ status }) {
  const colors = { connected: "#22c55e", disconnected: "#ef4444", error: "#f59e0b" };
  const labels = { connected: "● live", disconnected: "○ offline", error: "! errore" };
  return (
    <span style={{ color: colors[status] || "#6b7280", fontSize: "0.85em" }}>
      {labels[status] || status}
    </span>
  );
}
```

## `frontend/src/components/AlertCard.jsx`

```jsx
import { SignalBadge } from "./SignalBadge.jsx";

const ACTION_COLORS = {
  alarm: "#ef4444",
  notify: "#f59e0b",
  statistic: "#6b7280",
};

export function AlertCard({ alert }) {
  const color = ACTION_COLORS[alert.action] || "#6b7280";
  const time = new Date(alert.timestamp).toLocaleTimeString("it-IT");

  return (
    <div style={{ borderLeft: `4px solid ${color}`, padding: "12px", marginBottom: "8px",
                  background: "#1a1a1a", borderRadius: "4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <SignalBadge priority={alert.priority} signalId={alert.signal_id} />
        <span style={{ color: "#666", fontSize: "0.85em" }}>{time}</span>
      </div>
      <div style={{ marginTop: "4px", color: "#ccc", fontSize: "0.9em" }}>
        Area: <strong>{alert.area_id}</strong> — Score: {alert.score?.toFixed(3)}
      </div>
      {alert.llm_verdict?.confirmed && (
        <div style={{ marginTop: "4px", color: "#f59e0b", fontSize: "0.85em" }}>
          LLM: {alert.llm_verdict.description} ({(alert.llm_verdict.confidence * 100).toFixed(0)}%)
        </div>
      )}
    </div>
  );
}
```

## `frontend/src/components/AlertList.jsx`

```jsx
import { useAlerts } from "../hooks/useAlerts.js";
import { AlertCard } from "./AlertCard.jsx";
import { ConnectionStatus } from "./ConnectionStatus.jsx";

export function AlertList() {
  const { alerts, wsStatus } = useAlerts(50);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
        <h2>Alert recenti</h2>
        <ConnectionStatus status={wsStatus} />
      </div>
      {alerts.length === 0 && <p style={{ color: "#666" }}>Nessun alert ricevuto</p>}
      {alerts.map(a => <AlertCard key={a.event_id} alert={a} />)}
    </div>
  );
}
```

## `frontend/src/components/StatsChart.jsx`

```jsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useState, useEffect } from "react";
import { api } from "../api/client.js";

export function StatsChart({ areaId }) {
  const [data, setData] = useState([]);

  useEffect(() => {
    if (!areaId) return;
    const today = new Date().toISOString().split("T")[0];
    api.getStats({ areaId, date: today })
      .then(res => {
        const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}:00`, count: 0 }));
        (res.stats || []).forEach(s => { byHour[s.hour_bucket].count += s.count; });
        setData(byHour);
      })
      .catch(console.error);
  }, [areaId]);

  return (
    <div>
      <h3>Attività oggi — {areaId}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
          <YAxis />
          <Tooltip />
          <Bar dataKey="count" fill="#3b82f6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

## `frontend/src/pages/Dashboard.jsx`

```jsx
import { AlertList } from "../components/AlertList.jsx";
import { StatsChart } from "../components/StatsChart.jsx";
import { useState, useEffect } from "react";
import { api } from "../api/client.js";

export function Dashboard() {
  const [areas, setAreas] = useState([]);
  const [selectedArea, setSelectedArea] = useState(null);

  useEffect(() => {
    api.getConfig()
      .then(cfg => {
        setAreas(cfg.areas || []);
        if (cfg.areas?.length > 0) setSelectedArea(cfg.areas[0].id);
      })
      .catch(console.error);
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", padding: "24px" }}>
      <div><AlertList /></div>
      <div>
        <div style={{ marginBottom: "16px" }}>
          <label>Area: </label>
          <select value={selectedArea || ""} onChange={e => setSelectedArea(e.target.value)}>
            {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {selectedArea && <StatsChart areaId={selectedArea} />}
      </div>
    </div>
  );
}
```

## `frontend/src/App.jsx`

```jsx
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard.jsx";
import { Events } from "./pages/Events.jsx";
import { Config } from "./pages/Config.jsx";

export function App() {
  return (
    <BrowserRouter>
      <nav style={{ background: "#111", padding: "12px 24px", display: "flex", gap: "24px" }}>
        <span style={{ color: "#3b82f6", fontWeight: "bold" }}>VisionSemanticAgent</span>
        <Link to="/" style={{ color: "#ccc" }}>Dashboard</Link>
        <Link to="/events" style={{ color: "#ccc" }}>Events</Link>
        <Link to="/config" style={{ color: "#ccc" }}>Config</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/events" element={<Events />} />
        <Route path="/config" element={<Config />} />
      </Routes>
    </BrowserRouter>
  );
}
```

## `frontend/vite.config.js`

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
```

## Test frontend

```javascript
// frontend/src/components/__tests__/AlertCard.test.jsx
import { render, screen } from "@testing-library/react";
import { AlertCard } from "../AlertCard.jsx";

const mockAlert = {
  event_id: "e1", area_id: "lobby", signal_id: "smoking",
  score: 0.72, action: "notify", priority: 2,
  timestamp: "2025-04-23T14:30:00Z", llm_verdict: null,
};

test("AlertCard renders without crash", () => {
  render(<AlertCard alert={mockAlert} />);
  expect(screen.getByText(/lobby/)).toBeTruthy();
});

test("AlertCard shows score", () => {
  render(<AlertCard alert={mockAlert} />);
  expect(screen.getByText(/0\.720/)).toBeTruthy();
});

test("AlertCard shows llm verdict when confirmed", () => {
  const alert = { ...mockAlert,
    llm_verdict: { confirmed: true, description: "persona a terra", confidence: 0.9 } };
  render(<AlertCard alert={alert} />);
  expect(screen.getByText(/persona a terra/)).toBeTruthy();
});

test("AlertCard hides llm verdict when not confirmed", () => {
  const alert = { ...mockAlert,
    llm_verdict: { confirmed: false, description: "niente", confidence: 0.1 } };
  render(<AlertCard alert={alert} />);
  expect(screen.queryByText(/niente/)).toBeFalsy();
});
```

```javascript
// frontend/src/hooks/__tests__/useAlerts.test.js
import { renderHook } from "@testing-library/react";
import { useAlerts } from "../useAlerts.js";

vi.mock("../../api/client.js", () => ({
  api: { getAlerts: vi.fn().mockResolvedValue([]) }
}));

test("useAlerts initializes with empty array", async () => {
  const { result } = renderHook(() => useAlerts());
  expect(result.current.alerts).toEqual([]);
  expect(["connecting", "disconnected", "connected"]).toContain(result.current.wsStatus);
});
```

### Esecuzione test
```bash
cd frontend
npm install
npm test           # vitest
npm run dev        # dev server su :5173 con proxy → FastAPI :8000
```

### Test manuale end-to-end
```bash
# 1. FastAPI backend
source .venv/bin/activate
uvicorn api.main:app --port 8000 &

# 2. Frontend React
cd frontend && npm run dev &

# 3. Apri browser: http://localhost:5173

# 4. Invia alert test (simula engine)
curl -X POST http://localhost:8000/api/internal/alert \
  -H "Content-Type: application/json" \
  -d '{"event_id":"demo-1","area_id":"lobby","signal_id":"smoking","score":0.72,"action":"notify","priority":2,"timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'

# 5. Verificare che l'alert appaia in Dashboard entro 1 secondo
```

## Criteri di accettazione

- Dashboard mostra lista alert in real-time via WebSocket
- Nuovo alert appare entro 1s dall'invio `POST /api/internal/alert`
- Grafico statistiche mostra 24 bucket orari per area selezionata
- WebSocket si riconnette automaticamente entro 3s se disconnesso
- Proxy Vite risolve `/api/*` → FastAPI senza CORS errors in dev
- Test componenti passano

## Dipendenze

- Step 12 (FastAPI backend) operativo su porta 8000
- Step 09+ (LanceDB con dati) per `GET /api/events` e `GET /api/stats`
