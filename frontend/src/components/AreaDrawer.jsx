import { useEffect, useState } from "react";

const BASE_URL = import.meta.env.VITE_API_URL || "";

function getToken() {
  return localStorage.getItem("vsa_token");
}

function clipUrl(eventId) {
  return `${BASE_URL}/api/clips/${eventId}?token=${getToken()}`;
}

const ACTION_COLOR = { alarm: "var(--sev-alarm)", notify: "var(--sev-notify)", statistic: "var(--ink-3)" };
const ACTION_BG    = { alarm: "var(--sev-alarm-bg)", notify: "var(--sev-notify-bg)", statistic: "var(--sev-stat-bg)" };

export function AreaDrawer({ area, events, signals, range, onClose, onOpenEvent }) {
  const [view, setView] = useState("list");   // "list" | "detail"
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [clipError, setClipError] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // apply same time-range filter used by the rest of the dashboard
  const inRange = events
    .filter((e) => e.at >= range.from && e.at < range.to)
    .slice()
    .sort((a, b) => b.at - a.at); // newest first

  const selected = inRange[selectedIdx] || null;

  function openDetail(idx) {
    setSelectedIdx(idx);
    setClipError(false);
    setView("detail");
  }

  function goBack() {
    setView("list");
  }

  function goPrev() {
    setClipError(false);
    setSelectedIdx((i) => Math.max(0, i - 1));
  }

  function goNext() {
    setClipError(false);
    setSelectedIdx((i) => Math.min(inRange.length - 1, i + 1));
  }

  function sigName(signalId) {
    const s = signals?.find((x) => x.id === signalId);
    return s?.name || s?.id || signalId;
  }

  const hasPrev = selectedIdx > 0;
  const hasNext = selectedIdx < inRange.length - 1;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer area-drawer">

        {/* ── Header ── */}
        <div className="drw-head">
          <div className="drw-title">
            {view === "detail" ? (
              <>
                <h3>{sigName(selected?.signal_id)}</h3>
                <div className="crumb">{area.name} · {selected?.at_str}</div>
              </>
            ) : (
              <>
                <h3>{area.name}</h3>
                <div className="crumb">
                  {area.cameras?.length || 0} camera{area.cameras?.length !== 1 ? "s" : ""}
                  &nbsp;·&nbsp;{inRange.length} event{inRange.length !== 1 ? "s" : ""} in range
                </div>
              </>
            )}
          </div>
          <div className="drw-close" onClick={onClose}>×</div>
        </div>

        {/* ── Detail view ── */}
        {view === "detail" && selected && (
          <div className="drw-body">

            {/* Nav bar */}
            <div className="drw-nav">
              <button className="drw-nav-btn" onClick={goBack}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M9 2L4 7l5 5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Back
              </button>
              <div className="drw-nav-pager">
                <button className="drw-nav-btn icon" disabled={!hasPrev} onClick={goPrev} title="Previous event">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M9 2L4 7l5 5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <span className="drw-nav-count">{selectedIdx + 1} / {inRange.length}</span>
                <button className="drw-nav-btn icon" disabled={!hasNext} onClick={goNext} title="Next event">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M5 2l5 5-5 5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Video */}
            <div>
              <div className="drw-section-hd">Clip</div>
              {clipError ? (
                <div className="area-no-clip">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                    <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none"/>
                  </svg>
                  <span>
                    {selected?.clip_path?.startsWith("axis:")
                      ? "Video no longer available on camera"
                      : "Clip not available"}
                  </span>
                </div>
              ) : (
                <div className="area-video-wrap">
                  <video
                    key={selected.id}
                    className="area-video"
                    controls
                    autoPlay
                    preload="auto"
                    src={clipUrl(selected.id)}
                    onError={() => setClipError(true)}
                  />
                  <div className="area-video-meta">
                    <span className="rec">{selected.camera_id || area.cameras?.[0] || "CAM"}</span>
                    <span>{selected.at_str} · 1920×1080</span>
                  </div>
                </div>
              )}
            </div>

            {/* Event info */}
            <div className="drw-ev-info">
              <div className="drw-ev-info-row">
                <span className="drw-ev-info-lbl">Signal</span>
                <span className="drw-ev-info-val">{sigName(selected.signal_id)}</span>
              </div>
              <div className="drw-ev-info-row">
                <span className="drw-ev-info-lbl">Score</span>
                <span className="drw-ev-info-val mono">{selected.score?.toFixed(4)}</span>
              </div>
              <div className="drw-ev-info-row">
                <span className="drw-ev-info-lbl">Action</span>
                <span className="drw-ev-info-val">
                  <span className="tl-pill" data-sev={selected.action}>{selected.action}</span>
                </span>
              </div>
              <div className="drw-ev-info-row">
                <span className="drw-ev-info-lbl">Camera</span>
                <span className="drw-ev-info-val mono">{selected.camera_id || "—"}</span>
              </div>
              {selected.llm && (
                <div className="drw-ev-info-row">
                  <span className="drw-ev-info-lbl">LLM</span>
                  <span className="drw-ev-info-val">{selected.llm.verdict} · {Math.round((selected.llm.confidence || 0) * 100)}%</span>
                </div>
              )}
            </div>

            {/* Open full detail */}
            <button className="drw-open-full" onClick={() => { onOpenEvent(selected); }}>
              Open full detail
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M5 2H2v8h8V7M7 2h3v3M10 2L5 7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

          </div>
        )}

        {/* ── List view ── */}
        {view === "list" && (
          <div className="drw-body">
            {inRange.length === 0 ? (
              <div className="drw-empty">No events in the selected time range.</div>
            ) : (
              <div className="area-event-list">
                {inRange.map((e, idx) => {
                  const sig = signals?.find((x) => x.id === e.signal_id);
                  return (
                    <div
                      key={e.id}
                      className="area-ev-row"
                      onClick={() => openDetail(idx)}
                    >
                      <div className="area-ev-time">{e.at_str}</div>
                      <div className="area-ev-body">
                        <div className="area-ev-name">{sig?.name || e.signal_id}</div>
                        <div className="area-ev-sub">
                          <span className="tl-pill" data-sev={e.action}>{e.action}</span>
                          <span className="mono">score {e.score?.toFixed(3)}</span>
                        </div>
                      </div>
                      <button
                        className="area-ev-open"
                        title="View event"
                        onClick={(ev) => { ev.stopPropagation(); openDetail(idx); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M5 2l5 5-5 5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </>
  );
}
