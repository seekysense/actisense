import { useRef, useCallback } from "react";

function fmtHM(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function durStr(mins) {
  if (mins < 60) return mins + "m";
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function TimeBar({ range, setRange, eventsByHour, totalEvents }) {
  const trackRef = useRef(null);
  const dragStateRef = useRef(null);

  const toMin = (clientX) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(pct * 1440);
  };

  const onPointerDown = (mode) => (e) => {
    e.preventDefault();
    dragStateRef.current = { mode, startX: e.clientX, startFrom: range.from, startTo: range.to };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };

  const onPointerMove = useCallback((e) => {
    const st = dragStateRef.current;
    if (!st) return;
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dMin = Math.round((e.clientX - st.startX) / r.width * 1440);
    if (st.mode === "move") {
      const span = st.startTo - st.startFrom;
      let from = Math.max(0, Math.min(1440 - span, st.startFrom + dMin));
      setRange({ from, to: from + span });
    } else if (st.mode === "l") {
      const from = Math.max(0, Math.min(st.startTo - 30, st.startFrom + dMin));
      setRange({ from, to: st.startTo });
    } else if (st.mode === "r") {
      const to = Math.max(st.startFrom + 30, Math.min(1440, st.startTo + dMin));
      setRange({ from: st.startFrom, to });
    }
  }, [setRange]);

  const onPointerUp = () => {
    dragStateRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
  };

  const onTrackClick = (e) => {
    if (dragStateRef.current) return;
    if (e.target.closest?.(".timebar-window")) return;
    const cx = toMin(e.clientX);
    const span = range.to - range.from;
    const from = Math.max(0, Math.min(1440 - span, cx - Math.floor(span / 2)));
    setRange({ from, to: from + span });
  };

  const lPct = range.from / 1440 * 100;
  const wPct = (range.to - range.from) / 1440 * 100;
  const maxHr = Math.max(1, ...Object.values(eventsByHour).map((v) => v.total));

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const nowPct = nowMins / 1440 * 100;

  return (
    <div className="timebar">
      <div className="timebar-head">
        <div className="timebar-label">
          Timeline · {now.toLocaleDateString("en-GB", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
        </div>
        <div className="timebar-range">
          <span>{fmtHM(range.from)}</span>
          <span className="sep">→</span>
          <span>{fmtHM(range.to)}</span>
          <span className="dur">· {durStr(range.to - range.from)} · {totalEvents} events</span>
        </div>
      </div>

      <div className="timebar-track-wrap">
        <div
          className="timebar-track"
          ref={trackRef}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget || e.target.classList.contains("heat-cell") || e.target.classList.contains("heat-bar") || e.target.classList.contains("timebar-heat"))
              onTrackClick(e);
          }}
        >
          <div className="timebar-heat">
            {Array.from({ length: 24 }).map((_, h) => {
              const data = eventsByHour[h] || { total: 0, notify: 0, alarm: 0, statistic: 0 };
              const scale = 48 / maxHr;
              return (
                <div className="heat-cell" key={h}>
                  {data.statistic > 0 && (
                    <div className="heat-bar" style={{ height: Math.max(2, data.statistic * scale) }} />
                  )}
                  {data.notify > 0 && (
                    <div className="heat-bar notify" style={{ height: Math.max(2, data.notify * scale), left: "25%", right: "25%" }} />
                  )}
                  {data.alarm > 0 && (
                    <div className="heat-bar alarm" style={{ height: Math.max(3, data.alarm * scale * 1.5), left: "40%", right: "40%" }} />
                  )}
                </div>
              );
            })}
          </div>

          <div className="timebar-dim-l" style={{ left: 0, width: `${lPct}%` }} />
          <div className="timebar-dim-r" style={{ right: 0, width: `${100 - lPct - wPct}%` }} />

          <div
            className="timebar-window"
            style={{ left: `${lPct}%`, width: `${wPct}%` }}
            onPointerDown={onPointerDown("move")}
          >
            <div className="timebar-handle l" onPointerDown={(e) => { e.stopPropagation(); onPointerDown("l")(e); }} />
            <div className="timebar-handle r" onPointerDown={(e) => { e.stopPropagation(); onPointerDown("r")(e); }} />
          </div>

          <div className="timebar-now" style={{ left: `${nowPct}%` }} />
        </div>

        <div className="timebar-ticks">
          {Array.from({ length: 24 }).map((_, h) => (
            <div className="tick" key={h}>
              {h % 3 === 0 && <span>{String(h).padStart(2, "0")}:00</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
