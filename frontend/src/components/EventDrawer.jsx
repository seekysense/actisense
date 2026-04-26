import { useEffect } from "react";

export function EventDrawer({ event, onClose, onSelectEvent, allEventsForArea, signals }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!event) return null;

  const sig = signals?.find((s) => s.id === event.signal_id) || { text: event.signal_id, default_threshold: 0.5, default_action: event.action };
  const scorePct = Math.round(event.score * 100);
  const thrPct = Math.round((sig.default_threshold || 0.5) * 100);
  const over = event.score >= (sig.default_threshold || 0.5);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drw-head">
          <div className="drw-title">
            <h3>{sig.text}</h3>
            <div className="crumb">
              {event.area_id} · {event.at_str} · {event.id}
            </div>
          </div>
          <div className="drw-close" onClick={onClose}>×</div>
        </div>

        <div className="drw-body">
          <div>
            <div className="drw-section-hd">Captured Frame</div>
            <div className="frame">
              <div className="frame-meta">
                <span className="rec">REC · {event.camera_id || "CAM-01"}</span>
                <span>{event.at_str} · 1920×1080</span>
              </div>
            </div>
          </div>

          <div>
            <div className="drw-section-hd">Detection Pipeline</div>
            <div className="pipeline">
              <div className="pipe-step">
                <div className="lbl">1 · Embedder</div>
                <div className="val">{event.score?.toFixed(3) || "—"}</div>
                <div className="sub">cosine similarity</div>
                <div className="score-bar">
                  <div
                    className={"fill " + (over ? "over " : "") + (event.action || "")}
                    style={{ width: `${scorePct}%` }}
                  />
                </div>
              </div>
              <div className="pipe-step">
                <div className="lbl">2 · Threshold</div>
                <div className="val">≥ {(sig.default_threshold || 0.5).toFixed(2)}</div>
                <div className="sub">{over ? "passed" : "below"}</div>
              </div>
              <div className="pipe-step">
                <div className="lbl">3 · Action</div>
                <div className="val" style={{ textTransform: "capitalize" }}>{event.action}</div>
                <div className="sub">P{event.priority} · {sig.cooldown_sec || 300}s cooldown</div>
              </div>
            </div>
          </div>

          {event.llm && (
            <div>
              <div className="drw-section-hd">Vision LLM Verdict · {event.llm.verdict}</div>
              <div className="llm-card">
                <div className="llm-card-hd">
                  <div className="who">
                    <div className="llm-avatar" />
                    <span>{event.llm.model || "claude-haiku-4-5"}</span>
                  </div>
                  <div className="llm-card-meta mono">
                    {event.llm.latency_ms ? `${event.llm.latency_ms}ms · ` : ""}
                    conf {Math.round((event.llm.confidence || 0) * 100)}%
                  </div>
                </div>
                <div className="llm-card-body">
                  <p>{event.llm.text}</p>
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="drw-section-hd">Other Events · {event.area_id}</div>
            <div className="timeline-list">
              {(allEventsForArea || [])
                .filter((e) => e.id !== event.id)
                .slice(-10)
                .reverse()
                .map((e) => {
                  const s = signals?.find((x) => x.id === e.signal_id) || { text: e.signal_id };
                  return (
                    <div key={e.id} className="tl-item" onClick={() => onSelectEvent(e)}>
                      <div className="tl-time">{e.at_str}</div>
                      <div>
                        <div className="tl-sig">{s.text}</div>
                        <div className="tl-sub">
                          <span className="tl-pill" data-sev={e.action}>{e.action}</span>
                          <span className="mono">score {e.score?.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
