import { useState, useEffect } from "react";
import { api } from "../api/client.js";

export function Config() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getConfig()
      .then(setConfig)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading config…</div>;
  if (!config) return <div className="empty-state">Config unavailable.</div>;

  return (
    <div style={{ padding: 28 }}>
      <h2 style={{ marginBottom: 4, fontSize: 18, fontWeight: 600 }}>{config.site?.name}</h2>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 24 }}>
        {config.site?.id} · {config.site?.type}
      </div>

      <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-3)" }}>
        Areas ({config.areas?.length || 0})
      </h3>
      {(config.areas || []).map((a) => (
        <div key={a.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{a.name}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {a.camera_count || a.cameras?.length || 0} cameras · {a.signals?.length || 0} signals
          </div>
        </div>
      ))}

      <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, marginTop: 24, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-3)" }}>
        Signals ({config.signals?.length || 0})
      </h3>
      {(config.signals || []).map((s) => (
        <div key={s.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{s.text}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "monospace" }}>{s.id}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <span className="tl-pill" data-sev={s.default_action}>{s.default_action}</span>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--ink-3)" }}>P{s.priority}</span>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--ink-3)" }}>thr {s.default_threshold?.toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
