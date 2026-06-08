import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";

const KIND_META = {
  clip_downloaded: { icon: "download",        color: "#94a3b8",          label: "Downloaded" },
  clip_ingested:   { icon: "inbox",           color: "var(--accent)",    label: "Queued" },
  clip_processing: { icon: "autorenew",       color: "#6366f1",          label: "Processing" },
  clip_scored:     { icon: "analytics",       color: "#0ea5e9",          label: "Scored" },
  clip_dropped:    { icon: "delete_sweep",    color: "#f59e0b",          label: "Dropped" },
  llm_suppressed:  { icon: "do_not_disturb",  color: "var(--ink-4)",     label: "LLM suppressed" },
  clip_error:      { icon: "error_outline",   color: "#ef4444",          label: "Error" },
  action_fired:    { icon: "check_circle",    color: "#10b981",          label: "Event saved" },
};

const ALL_KINDS = Object.keys(KIND_META);

function fmtRelative(ts) {
  if (!ts) return "—";
  const sec = Math.floor(Date.now() / 1000 - ts);
  if (sec < 5)  return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function KindBadge({ kind }) {
  const m = KIND_META[kind] || { icon: "info", color: "var(--ink-4)", label: kind };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999,
      background: m.color + "18", color: m.color,
      fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
    }}>
      <span className="mi" style={{ fontSize: 13 }}>{m.icon}</span>
      {m.label}
    </span>
  );
}

function LogEntry({ entry }) {
  const ts = entry.ts;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "130px 1fr",
      gap: "6px 14px",
      padding: "10px 0",
      borderBottom: "1px solid var(--line)",
      alignItems: "start",
    }}>
      {/* left: kind + time */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <KindBadge kind={entry.kind} />
        <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "'Geist Mono', monospace" }}>
          {fmtTime(ts)}
        </span>
        <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{fmtRelative(ts)}</span>
      </div>
      {/* right: details */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {entry.camera_id && (
            <span style={{ fontSize: 12, fontFamily: "'Geist Mono', monospace", color: "var(--ink-2)" }}>
              {entry.camera_id}
            </span>
          )}
          {entry.area_id && (
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{entry.area_id}</span>
          )}
          {entry.signal_id && (
            <span style={{
              fontSize: 11, padding: "1px 6px", borderRadius: 4,
              background: "var(--surface)", border: "1px solid var(--line)",
              color: "var(--ink-3)",
            }}>{entry.signal_id}</span>
          )}
          {entry.score != null && (
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: entry.score >= 0.5 ? "#10b981" : "var(--ink-3)",
              fontFamily: "'Geist Mono', monospace",
            }}>
              {entry.score.toFixed(3)}
            </span>
          )}
          {entry.action && (
            <span style={{
              fontSize: 11, padding: "1px 6px", borderRadius: 4,
              background: entry.action === "alarm" ? "#ef444418" : entry.action === "notify" ? "#f59e0b18" : "var(--surface)",
              color: entry.action === "alarm" ? "#ef4444" : entry.action === "notify" ? "#f59e0b" : "var(--ink-4)",
              border: "1px solid var(--line)",
            }}>{entry.action}</span>
          )}
        </div>
        {entry.detail && (
          <span style={{
            fontSize: 11, color: "var(--ink-3)", lineHeight: 1.4,
            fontStyle: "italic",
          }}>
            {entry.detail}
          </span>
        )}
        {entry.recording_id && (
          <span style={{
            fontSize: 10, color: "var(--ink-4)",
            fontFamily: "'Geist Mono', monospace",
          }}>
            {entry.recording_id}
          </span>
        )}
      </div>
    </div>
  );
}

export default function Logs() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(() => {
    api.getLogs({ limit: 100, kind: kindFilter || undefined })
      .then(res => {
        setEntries(res.entries || []);
        setLastRefresh(new Date());
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [kindFilter]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const visible = entries.filter(e => !kindFilter || e.kind === kindFilter);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* header */}
      <div style={{
        borderBottom: "1px solid var(--line)",
        padding: "0 24px",
        display: "flex", alignItems: "center", gap: 12, height: 52,
        background: "var(--surface)",
      }}>
        <button
          onClick={() => navigate("/setup")}
          style={{
            background: "none", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4,
            color: "var(--ink-3)", fontSize: 13,
          }}
        >
          <span className="mi" style={{ fontSize: 16 }}>arrow_back</span>
          Setup
        </button>
        <span style={{ color: "var(--ink-4)" }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>Engine Logs</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-4)" }}>
          {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString("en-GB")} · auto-refresh 10s` : "Loading…"}
        </span>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 24px" }}>
        {/* title */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Engine Logs</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>
            Last {entries.length} engine events — clip processing, LLM decisions, errors.
          </p>
        </div>

        {/* filter pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
          <button
            onClick={() => setKindFilter(null)}
            style={{
              padding: "4px 12px", borderRadius: 999, fontSize: 11, fontWeight: 600,
              border: "1px solid var(--line)", cursor: "pointer",
              background: !kindFilter ? "var(--accent)" : "var(--surface)",
              color: !kindFilter ? "white" : "var(--ink-2)",
            }}
          >All</button>
          {ALL_KINDS.map(k => {
            const m = KIND_META[k];
            const active = kindFilter === k;
            return (
              <button key={k}
                onClick={() => setKindFilter(active ? null : k)}
                style={{
                  padding: "4px 12px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${active ? m.color : "var(--line)"}`, cursor: "pointer",
                  background: active ? m.color + "18" : "var(--surface)",
                  color: active ? m.color : "var(--ink-3)",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}
              >
                <span className="mi" style={{ fontSize: 12 }}>{m.icon}</span>
                {m.label}
              </button>
            );
          })}
        </div>

        {/* log list */}
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          padding: "0 16px",
        }}>
          {loading && (
            <div style={{ padding: "32px 0", textAlign: "center", color: "var(--ink-4)", fontSize: 13 }}>
              Loading…
            </div>
          )}
          {!loading && visible.length === 0 && (
            <div style={{ padding: "48px 0", textAlign: "center", color: "var(--ink-4)", fontSize: 13 }}>
              <span className="mi" style={{ fontSize: 32, display: "block", marginBottom: 8, color: "var(--ink-4)" }}>
                terminal
              </span>
              No log entries yet. Events will appear here as the engine processes clips.
            </div>
          )}
          {!loading && visible.map((e, i) => (
            <LogEntry key={`${e.ts}-${i}`} entry={e} />
          ))}
        </div>
      </div>
    </div>
  );
}
