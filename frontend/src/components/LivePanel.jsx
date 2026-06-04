import { useEffect, useRef, useState } from "react";
import { useLiveStatus } from "../hooks/useLiveStatus.js";

const KIND_ICON = {
  clip_ingested:   { icon: "arrow_downward",   color: "var(--accent)" },
  clip_processing: { icon: "autorenew",         color: "var(--ink-3)" },
  clip_scored:     { icon: "analytics",         color: "var(--sev-notify)" },
  clip_dropped:    { icon: "block",             color: "var(--sev-alarm)" },
};

const ACTION_COLOR = {
  alarm:     "var(--sev-alarm)",
  notify:    "var(--sev-notify)",
  statistic: "var(--sev-stat)",
};

const FILTER_KINDS = ["all", "clip_ingested", "clip_processing", "clip_scored", "clip_dropped"];

function fmtTime(ts) {
  if (!ts) return "--:--";
  return new Date(ts * 1000).toLocaleTimeString("it-IT", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtAgo(ts) {
  if (!ts) return "never";
  const sec = Math.floor((Date.now() / 1000) - ts);
  if (sec < 5)  return "just now";
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function fmtSec(ms) {
  const s = Math.floor(ms);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

// ── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ queue, pendingSummary }) {
  const offline = !queue;
  const busy = queue?.workers_busy ?? 0;
  const max  = queue?.max_workers  ?? 0;
  const depth = queue?.queue_depth ?? 0;
  const avgMs = queue?.avg_latency_ms ?? 0;
  const etaMin = (depth > 0 && busy > 0 && avgMs > 0)
    ? Math.ceil((depth * avgMs / 1000) / busy / 60)
    : 0;

  const pendingArea = pendingSummary?.pending_by_area || {};
  const totalPending = Object.values(pendingArea).reduce((a, b) => a + b, 0);

  return (
    <div style={{
      background: offline ? "var(--surface)" : "var(--bg-2)",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius)",
      padding: "10px 14px",
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    }}>
      <span className="mi" style={{ fontSize: 16, color: offline ? "var(--ink-4)" : "var(--accent)" }}>
        {offline ? "cloud_off" : "memory"}
      </span>
      {offline ? (
        <span style={{ fontSize: 12, color: "var(--ink-4)", fontStyle: "italic" }}>
          Engine offline — no heartbeat received yet.
        </span>
      ) : (
        <>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
            {totalPending > 0 ? `${totalPending} clip${totalPending > 1 ? "s" : ""} in coda` : "In pari"}
            {depth > 0 && ` · ${busy}/${max} worker${busy !== 1 ? "s" : ""} occupati`}
            {etaMin > 0 && ` · ~${etaMin} min stimati`}
          </span>
        </>
      )}
    </div>
  );
}

// ── Pills ────────────────────────────────────────────────────────────────────

function PendingPills({ pendingByArea, pendingByCamera }) {
  const areaEntries = Object.entries(pendingByArea || {}).filter(([, n]) => n > 0);
  const camEntries  = Object.entries(pendingByCamera || {}).filter(([, n]) => n > 0);
  if (!areaEntries.length && !camEntries.length) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {areaEntries.map(([area, n]) => (
        <span key={area} style={{
          fontSize: 11, fontWeight: 600,
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: 999, padding: "3px 10px", color: "var(--ink-2)",
        }}>
          {area}: {n} da elaborare
        </span>
      ))}
      {camEntries.map(([cam, n]) => (
        <span key={cam} style={{
          fontSize: 11, fontWeight: 500,
          background: "var(--bg-2)", border: "1px solid var(--line)",
          borderRadius: 999, padding: "3px 10px", color: "var(--ink-3)",
        }}>
          {cam}: {n}
        </span>
      ))}
    </div>
  );
}

// ── Queue status card ────────────────────────────────────────────────────────

function QueueCard({ queue }) {
  const offline = !queue;
  const busy = queue?.workers_busy ?? 0;
  const max  = queue?.max_workers  ?? 0;
  const busyPct = max > 0 ? (busy / max) * 100 : 0;
  const depth = queue?.queue_depth ?? 0;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--line)",
      borderRadius: "var(--radius)", overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px 8px", borderBottom: "1px solid var(--line)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span className="mi" style={{ fontSize: 15, color: offline ? "var(--ink-4)" : "var(--accent)" }}>
          {offline ? "cloud_off" : "memory"}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>Queue</span>
        {offline && (
          <span style={{
            marginLeft: "auto", fontSize: 10, fontWeight: 600,
            color: "var(--ink-4)", letterSpacing: ".06em", textTransform: "uppercase",
          }}>engine offline</span>
        )}
      </div>

      {offline ? (
        <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--ink-4)", fontStyle: "italic" }}>
          No heartbeat received yet. Start the engine to see live data.
        </div>
      ) : (
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Workers bar */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Workers</span>
              <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, color: "var(--ink-2)" }}>
                {busy} / {max} busy
              </span>
            </div>
            <div style={{ height: 4, background: "var(--line)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                background: busyPct === 100 ? "var(--sev-alarm)" : "var(--accent)",
                width: `${busyPct}%`, transition: "width .4s",
              }} />
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[
              { label: "In queue", val: depth, hi: depth > 5 },
              { label: "Processed", val: queue.processed_count },
              { label: "Dropped",   val: queue.dropped_count, hi: queue.dropped_count > 0 },
            ].map(({ label, val, hi }) => (
              <div key={label} style={{
                background: "var(--bg-2)", border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)", padding: "8px 10px",
              }}>
                <div style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 3 }}>
                  {label}
                </div>
                <div style={{
                  fontFamily: "'Geist Mono', monospace", fontSize: 16, fontWeight: 600,
                  color: hi ? "var(--sev-alarm)" : "var(--ink)",
                }}>
                  {val ?? 0}
                </div>
              </div>
            ))}
          </div>

          {/* Avg latency */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
            <span style={{ color: "var(--ink-3)" }}>Avg processing time</span>
            <span style={{ fontFamily: "'Geist Mono', monospace", color: "var(--ink-2)" }}>
              {queue.avg_latency_ms > 0 ? `${(queue.avg_latency_ms / 1000).toFixed(1)} s` : "—"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Active jobs ──────────────────────────────────────────────────────────────

function ActiveJobs({ jobs }) {
  if (!jobs || jobs.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--ink-4)", fontStyle: "italic", padding: "4px 0" }}>
        No active jobs.
      </div>
    );
  }
  const now = Date.now() / 1000;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {jobs.map((j, i) => (
        <div key={`${j.recording_id}-${i}`} style={{
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: "var(--radius-sm)", padding: "8px 12px",
          display: "flex", alignItems: "center", gap: 10, fontSize: 11,
        }}>
          <span className="mi" style={{ fontSize: 14, color: "var(--accent)" }}>play_circle</span>
          <span style={{ fontFamily: "'Geist Mono', monospace", color: "var(--ink-2)", flex: 1 }}>
            {j.camera_id}
          </span>
          <span style={{ color: "var(--ink-3)" }}>{j.area_id}</span>
          <span style={{ fontFamily: "'Geist Mono', monospace", color: "var(--ink-4)" }}>
            in coda da {fmtSec(now - j.enqueued_at)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Camera heartbeat list ────────────────────────────────────────────────────

function CameraList({ cameras }) {
  const entries = Object.entries(cameras);

  if (entries.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--ink-4)", fontStyle: "italic", padding: "4px 0" }}>
        No camera data yet.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(([camId, stat]) => {
        const ok = stat.reachable !== false;
        const stale = stat.last_clip_at && (Date.now() / 1000 - stat.last_clip_at) > 300;
        const pollStale = stat.last_poll_at && (Date.now() / 1000 - stat.last_poll_at) > 300;
        const statusColor = !ok ? "var(--sev-alarm)" : stale ? "var(--sev-notify)" : "var(--ok)";

        return (
          <div key={camId} style={{
            background: "var(--surface)", border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)", padding: "8px 12px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
              background: statusColor,
              boxShadow: ok && !stale ? `0 0 6px ${statusColor}` : "none",
            }} />
            <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12, flex: 1, color: "var(--ink-2)" }}>
              {camId}
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-4)" }}>
              poll {fmtAgo(stat.last_poll_at)}
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-4)" }}>
              clip {fmtAgo(stat.last_clip_at)}
            </span>
            {stat.clips_last_hour > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 600,
                background: "var(--bg-2)", border: "1px solid var(--line)",
                borderRadius: 999, padding: "1px 7px", color: "var(--ink-3)",
              }}>
                {stat.clips_last_hour} clips/h
              </span>
            )}
            {pollStale && (
              <span style={{ fontSize: 10, color: "var(--sev-alarm)", fontWeight: 600 }}>
                ⚠️ poll vecchio
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Activity log ─────────────────────────────────────────────────────────────

function ActivityRow({ ev }) {
  const { icon, color } = KIND_ICON[ev.kind] || { icon: "info", color: "var(--ink-4)" };

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "20px 1fr auto",
      gap: 8, padding: "7px 0", borderBottom: "1px solid var(--line)",
      alignItems: "start",
    }}>
      <span className="mi" style={{ fontSize: 14, color, marginTop: 1 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink)", marginBottom: 2 }}>
          {ev.kind.replace(/_/g, " ")}
          {ev.score != null && (
            <span style={{
              marginLeft: 7, fontSize: 10.5, fontFamily: "'Geist Mono', monospace",
              color: ev.action ? ACTION_COLOR[ev.action] || "var(--ink-3)" : "var(--ink-3)",
            }}>
              {ev.score.toFixed(2)}
              {ev.action && ` · ${ev.action}`}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-4)", display: "flex", gap: 8 }}>
          {ev.camera_id && (
            <span style={{ fontFamily: "'Geist Mono', monospace" }}>{ev.camera_id}</span>
          )}
          {ev.signal_id && (
            <span>{ev.signal_id}</span>
          )}
          {ev.detail && <span style={{ color: "var(--sev-alarm)" }}>{ev.detail}</span>}
        </div>
      </div>
      <span style={{ fontSize: 10.5, color: "var(--ink-4)", fontFamily: "'Geist Mono', monospace", whiteSpace: "nowrap" }}>
        {fmtTime(ev.ts)}
      </span>
    </div>
  );
}

function ActivityLog({ activity }) {
  const endRef = useRef(null);
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all" ? activity : activity.filter((ev) => ev.kind === filter);

  if (activity.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--ink-4)", fontStyle: "italic", padding: "4px 0" }}>
        No activity yet. Engine events will appear here in real-time.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {FILTER_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{
              fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em",
              border: "1px solid var(--line)", borderRadius: 999,
              padding: "2px 8px", cursor: "pointer",
              background: filter === k ? "var(--accent)" : "var(--bg-2)",
              color: filter === k ? "#fff" : "var(--ink-3)",
            }}
          >
            {k.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      {filtered.map((ev, i) => (
        <ActivityRow key={`${ev.ts}-${i}`} ev={ev} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

// ── Main LivePanel ───────────────────────────────────────────────────────────

export function LivePanel({ subscribe, onClose }) {
  const { queue, cameras, activity, pendingSummary } = useLiveStatus(subscribe, true);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" style={{ width: 420 }}>
        {/* Header */}
        <div className="drw-head">
          <div className="drw-title">
            <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: queue ? "var(--ok)" : "var(--ink-4)",
                boxShadow: queue ? "0 0 6px var(--ok)" : "none",
                flexShrink: 0, display: "inline-block",
              }} />
              Live monitor
            </h3>
            <div className="crumb">Engine activity · real-time</div>
          </div>
          <button className="drw-close" onClick={onClose}>×</button>
        </div>

        {/* Body */}
        <div className="drw-body" style={{ gap: 16 }}>

          {/* Summary */}
          <SummaryBar queue={queue} pendingSummary={pendingSummary} />

          {/* Pending pills */}
          <PendingPills
            pendingByArea={pendingSummary?.pending_by_area}
            pendingByCamera={pendingSummary?.pending_by_camera}
          />

          {/* Queue */}
          <div>
            <div className="drw-section-hd">Queue</div>
            <QueueCard queue={queue} />
          </div>

          {/* Active jobs */}
          <div>
            <div className="drw-section-hd">
              Elaborazioni attive
              <span style={{ marginLeft: 6, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                · {pendingSummary?.current_jobs?.length ?? 0}
              </span>
            </div>
            <ActiveJobs jobs={pendingSummary?.current_jobs} />
          </div>

          {/* Cameras */}
          <div>
            <div className="drw-section-hd">
              Cameras
              <span style={{ marginLeft: 6, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                · {Object.keys(cameras).length} known
              </span>
            </div>
            <CameraList cameras={cameras} />
          </div>

          {/* Activity stream */}
          <div style={{ flex: 1 }}>
            <div className="drw-section-hd">
              Activity
              <span style={{ marginLeft: 6, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                · last {activity.length}
              </span>
            </div>
            <ActivityLog activity={activity} />
          </div>

        </div>
      </div>
    </>
  );
}
