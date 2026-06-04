import { useState, useEffect } from "react";
import { api } from "../api/client.js";

export function Events() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEvents({ limit: 100 })
      .then((res) => setData(res.events || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading events…</div>;

  return (
    <div style={{ padding: 28 }}>
      <h2 style={{ marginBottom: 16, fontSize: 18, fontWeight: 600 }}>Event History</h2>
      {data.length === 0 ? (
        <div className="empty-state">No events in database yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left" }}>
              {["Time", "Area", "Signal", "Score", "Action", "Priority"].map((h) => (
                <th key={h} style={{ padding: "6px 12px", color: "var(--ink-3)", fontWeight: 600, fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.event_id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>
                  {e.timestamp ? new Date(e.timestamp).toLocaleTimeString("en-GB") : "—"}
                </td>
                <td style={{ padding: "8px 12px" }}>{e.area_id}</td>
                <td style={{ padding: "8px 12px" }}>{e.signal_id}</td>
                <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{e.score?.toFixed(3)}</td>
                <td style={{ padding: "8px 12px" }}>
                  <span className="tl-pill" data-sev={e.action}>{e.action}</span>
                </td>
                <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>P{e.priority || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
