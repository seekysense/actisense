// ActiSense dashboard — main app
/* global React, ReactDOM, SIGNALS, AREAS, EVENTS, signalById, areaById, _fmtT */
/* global TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakToggle, TweakColor */

const { useState, useMemo, useEffect, useRef, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "density": "comfy",
  "accent": "#3a8a7a",
  "showLLMBadges": true,
  "animateAlarms": true
} /*EDITMODE-END*/;

const PRIORITIES = [1, 2, 3, 4, 5];
const ACTIONS = ['statistic', 'notify', 'alarm'];

// ─────────────────────────────────────────────────────────────────────────────
function fmtHM(mins) {
  const h = Math.floor(mins / 60),m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function durStr(mins) {
  if (mins < 60) return mins + 'm';
  const h = Math.floor(mins / 60),m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
function Sidebar({
  open, onCloseMobile,
  areaFilter, setAreaFilter,
  priorityFilter, setPriorityFilter,
  actionFilter, setActionFilter,
  areaCounts
}) {
  const toggleArea = (id) => {
    setAreaFilter((f) => f.includes(id) ? f.filter((x) => x !== id) : [...f, id]);
  };
  const togglePriority = (p) => {
    setPriorityFilter((f) => f.includes(p) ? f.filter((x) => x !== p) : [...f, p]);
  };
  const toggleAction = (a) => {
    setActionFilter((f) => f.includes(a) ? f.filter((x) => x !== a) : [...f, a]);
  };
  return (
    <>
      <div className={"sidebar-scrim " + (open ? "on" : "")} onClick={onCloseMobile} />
      <aside className={"sidebar " + (open ? "open" : "")}>
        <div className="site-card">
          <div className="site-brand">
            <img src="logo.svg" alt="ActiSense" className="site-brand-logo" />
            <div>
              <div className="site-brand-name">H4H Vision AI
              </div>
              <div className="site-brand-tag">BETA</div>
            </div>
          </div>
          <div className="site-select">
            <div>
              <div className="site-select-name">The Castelletto</div>
              <div className="site-select-meta">Palermo · {AREAS.length} areas · {AREAS.reduce((a, b) => a + b.cameras, 0)} cameras</div>
            </div>
            <div className="site-select-chev">▾</div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">
            <span>Areas</span>
            <span className="count">
              {areaFilter.length === 0 ? 'all' : `${areaFilter.length}/${AREAS.length}`}
            </span>
          </div>
          <div className="filter-list">
            {AREAS.map((a) => {const on = areaFilter.length === 0 || areaFilter.includes(a.id);
              return (
                <div key={a.id} className={"filter-item " + (areaFilter.includes(a.id) ? "on" : "")} onClick={() => toggleArea(a.id)}>
                  <div className="filter-check" />
                  <div className="filter-label">{a.name}</div>
                  <div className="filter-meta">{areaCounts[a.id] || 0}</div>
                </div>);

            })}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label"><span>Priority</span><span className="count">1 crit · 5 info</span></div>
          <div className="pri-row">
            {PRIORITIES.map((p) =>
            <div key={p}
            className={"pri-btn p" + p + " " + (priorityFilter.includes(p) ? "on" : "")}
            onClick={() => togglePriority(p)}>P{p}</div>
            )}
          </div>
        </div>

        <div className="sidebar-section" style={{ paddingBottom: 16 }}>
          <div className="sidebar-label"><span>Action</span></div>
          <div className="action-chips">
            {ACTIONS.map((a) =>
            <div key={a}
            data-sev={a}
            className={"action-chip " + (actionFilter.includes(a) ? "on" : "")}
            onClick={() => toggleAction(a)}>
                <span className="dot" />{a}
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-foot">
          <div className="avatar">MR</div>
          <div className="who">
            <div className="who-name">Marta Ruffini</div>
            <div className="who-role">Facility Manager</div>
          </div>
        </div>
      </aside>
    </>);

}

// ─────────────────────────────────────────────────────────────────────────────
// Timebar — range selector
function TimeBar({ range, setRange, eventsByHour, totalEvents }) {
  const trackRef = useRef(null);
  const dragStateRef = useRef(null); // {mode: 'move'|'l'|'r', startX, startFrom, startTo}

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
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };
  const onPointerMove = useCallback((e) => {
    const st = dragStateRef.current;
    if (!st) return;
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dMin = Math.round((e.clientX - st.startX) / r.width * 1440);
    if (st.mode === 'move') {
      const span = st.startTo - st.startFrom;
      let from = st.startFrom + dMin;
      from = Math.max(0, Math.min(1440 - span, from));
      setRange({ from, to: from + span });
    } else if (st.mode === 'l') {
      let from = Math.max(0, Math.min(st.startTo - 30, st.startFrom + dMin));
      setRange({ from, to: st.startTo });
    } else if (st.mode === 'r') {
      let to = Math.max(st.startFrom + 30, Math.min(1440, st.startTo + dMin));
      setRange({ from: st.startFrom, to });
    }
  }, [setRange]);
  const onPointerUp = () => {
    dragStateRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
  };

  // Click on track (outside window) moves window
  const onTrackClick = (e) => {
    if (dragStateRef.current) return;
    if (e.target.closest('.timebar-window')) return;
    const cx = toMin(e.clientX);
    const span = range.to - range.from;
    let from = Math.max(0, Math.min(1440 - span, cx - Math.floor(span / 2)));
    setRange({ from, to: from + span });
  };

  const lPct = range.from / 1440 * 100;
  const wPct = (range.to - range.from) / 1440 * 100;
  const nowPct = 50; // 12:00 — fixed "now" for the mock

  // heat bars per hour (max scales to visible max)
  const maxHr = Math.max(1, ...Object.values(eventsByHour).map((v) => v.total));
  const inRange = (ev) => ev.at >= range.from && ev.at < range.to;

  return (
    <div className="timebar">
      <div className="timebar-head">
        <div className="timebar-label">Timeline · Today, Apr 23 2026</div>
        <div className="timebar-range">
          <span>{fmtHM(range.from)}</span>
          <span className="sep">→</span>
          <span>{fmtHM(range.to)}</span>
          <span className="dur">· {durStr(range.to - range.from)} · {totalEvents} events</span>
        </div>
      </div>

      <div className="timebar-track-wrap">
        <div className="timebar-track" ref={trackRef} onPointerDown={(e) => {if (e.target === e.currentTarget || e.target.classList.contains('timebar-heat') || e.target.classList.contains('heat-cell')) onTrackClick(e);}}>
          <div className="timebar-heat">
            {Array.from({ length: 24 }).map((_, h) => {
              const data = eventsByHour[h] || { total: 0, notify: 0, alarm: 0, statistic: 0 };
              const scale = 48 / maxHr;
              return (
                <div className="heat-cell" key={h}>
                  {data.statistic > 0 && <div className="heat-bar" style={{ height: Math.max(2, data.statistic * scale) }} />}
                  {data.notify > 0 && <div className="heat-bar notify" style={{ height: Math.max(2, data.notify * scale), left: '25%', right: '25%' }} />}
                  {data.alarm > 0 && <div className="heat-bar alarm" style={{ height: Math.max(3, data.alarm * scale * 1.5), left: '40%', right: '40%' }} />}
                </div>);

            })}
          </div>

          {/* dim overlays */}
          <div className="timebar-dim-l" style={{ left: 0, width: `${lPct}%` }} />
          <div className="timebar-dim-r" style={{ right: 0, width: `${100 - lPct - wPct}%` }} />

          {/* window */}
          <div className="timebar-window"
          style={{ left: `${lPct}%`, width: `${wPct}%` }}
          onPointerDown={onPointerDown('move')}>
            <div className="timebar-handle l" onPointerDown={(e) => {e.stopPropagation();onPointerDown('l')(e);}} />
            <div className="timebar-handle r" onPointerDown={(e) => {e.stopPropagation();onPointerDown('r')(e);}} />
          </div>

          {/* now */}
          <div className="timebar-now" style={{ left: `${nowPct}%` }} />
        </div>

        <div className="timebar-ticks">
          {Array.from({ length: 24 }).map((_, h) =>
          <div className="tick" key={h}>
              {h % 3 === 0 && <span>{String(h).padStart(2, '0')}:00</span>}
            </div>
          )}
        </div>
      </div>
    </div>);

}

// ─────────────────────────────────────────────────────────────────────────────
// Area tile
function AreaTile({ area, events, range, onOpenEvent, onOpenSignal, signalStates, tweaks }) {
  const inRangeEvents = events.filter((e) => e.at >= range.from && e.at < range.to);
  const alarms = inRangeEvents.filter((e) => e.action === 'alarm').length;
  const notifies = inRangeEvents.filter((e) => e.action === 'notify').length;
  const stats = inRangeEvents.length - alarms - notifies;

  let sev = 'ok';
  if (alarms > 0) sev = 'alarm';else
  if (notifies > 0) sev = 'notify';else
  if (stats > 0) sev = 'statistic';

  const sevLabel = {
    ok: 'Clear',
    statistic: 'Normal',
    notify: `${notifies} notify`,
    alarm: `${alarms} alarm${alarms > 1 ? 's' : ''}`
  }[sev];

  // Sparkline: 24 hourly bins over the full day, colored by highest-severity action in bin
  const bins = Array.from({ length: 24 }, () => ({ total: 0, sev: 'idle' }));
  events.forEach((e) => {
    const h = Math.floor(e.at / 60);
    bins[h].total += 1;
    const rank = { idle: 0, statistic: 1, notify: 2, alarm: 3 };
    if (rank[e.action] > rank[bins[h].sev]) bins[h].sev = e.action;
  });
  const maxBin = Math.max(1, ...bins.map((b) => b.total));

  // Latest event for the click-to-detail
  const latest = inRangeEvents[inRangeEvents.length - 1] || events[events.length - 1];

  // Signals state (enabled + threshold override from parent)
  const signalsForArea = area.signals.map((as) => {
    const sig = signalById(as.signal_id);
    const state = signalStates[`${area.id}:${as.signal_id}`] || { enabled: as.enabled, threshold: as.threshold_override ?? sig.default_threshold };
    const count = inRangeEvents.filter((e) => e.signal_id === as.signal_id).length;
    return { as, sig, state, count };
  });

  return (
    <div className={"tile sev-" + sev}>
      <div className="tile-head" onClick={() => latest && onOpenEvent(latest)} style={{ cursor: latest ? 'default' : 'default' }}>
        <div className="tile-area">
          <h3 className="tile-area-name">{area.name}</h3>
          <div className="tile-area-meta">
            <span>{area.floor}</span>
            <span className="dot-sep" />
            <span>{area.cameras} camera{area.cameras > 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="sev-badge" data-sev={sev}>
          {tweaks.animateAlarms && sev === 'alarm' && <span className="pulse" />}
          {sev !== 'alarm' && <span className="pulse" />}
          {sevLabel}
        </div>
      </div>

      <div className="tile-stats">
        <div className="stat">
          <div className="stat-v">{inRangeEvents.length}</div>
          <div className="stat-l">Events</div>
        </div>
        <div className="stat">
          <div className={"stat-v " + (notifies ? "notify" : "")}>{notifies}</div>
          <div className="stat-l">Notify</div>
        </div>
        <div className="stat">
          <div className={"stat-v " + (alarms ? "alarm" : "")}>{alarms}</div>
          <div className="stat-l">Alarm</div>
        </div>
      </div>

      <div className="tile-spark" title="24h event density">
        {bins.map((b, i) => {
          const inSel = i * 60 >= range.from && i * 60 < range.to;
          const cls = b.total === 0 ? 'spark-b' : 'spark-b ' + (b.sev === 'alarm' ? 'alarm' : b.sev === 'notify' ? 'notify' : inSel ? 'in-range' : '');
          return <div key={i} className={cls} style={{ height: b.total ? `${4 + b.total / maxBin * 22}px` : '2px', opacity: inSel || b.total === 0 ? 1 : 0.45 }} />;
        })}
      </div>

      <div className="tile-signals">
        <div className="tile-signals-hd">
          <span>Active Signals · {signalsForArea.length}</span>
        </div>
        {signalsForArea.map(({ as, sig, state, count }) =>
        <div key={sig.id} className={"sig " + (state.enabled ? "" : "disabled")}>
            <div className={"sig-state " + (state.enabled ? "active " + sig.default_action : "off")} />
            <div className="sig-text">{sig.text}</div>
            <div className="sig-meta">
              <span className={"count " + (count > 0 && sig.default_action !== 'statistic' ? "hi" : "")}>{count}</span>
              <button className="sig-cog" aria-label="Configure signal" title="Configure signal"
            onClick={(e) => {e.stopPropagation();onOpenSignal({ area, as, sig, state });}}>
                <span className="mi">settings</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>);

}

// ─────────────────────────────────────────────────────────────────────────────
// Threshold / signal override popover
function SignalPopover({ data, onClose, onChange }) {
  if (!data) return null;
  const { area, sig, state } = data;
  const [local, setLocal] = useState(state);

  useEffect(() => {
    const onKey = (e) => {if (e.key === 'Escape') onClose();};
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (patch) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(area.id, sig.id, next);
  };

  // Position near the center of screen
  const style = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover" style={style}>
        <div className="pop-head">
          <div className="pop-title">Signal override · {area.name}</div>
          <div className="pop-close" onClick={onClose}>×</div>
        </div>
        <div className="pop-sig">{sig.text}</div>
        <div className="pop-meta">
          <span className="mono">{sig.id}</span>
          <span className="dot-sep" />
          <span>Priority P{sig.priority}</span>
          <span className="dot-sep" />
          <span>{sig.source === 'native_axis' ? 'Native Axis' : 'Embedder'}</span>
        </div>

        <div className="pop-row" style={{ borderTop: 0, paddingTop: 0 }}>
          <div>
            <div className="pop-row-label">Enabled for this area</div>
            <div className="pop-row-sub">Pause the signal without removing configuration</div>
          </div>
          <div className={"sig-toggle " + (local.enabled ? "on" : "")}
          style={{ width: 32, height: 18 }}
          onClick={() => save({ enabled: !local.enabled })} />
        </div>

        <div className="pop-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div>
              <div className="pop-row-label">Similarity threshold</div>
              <div className="pop-row-sub">Default {sig.default_threshold.toFixed(2)} · higher = fewer false positives</div>
            </div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>{local.threshold.toFixed(2)}</div>
          </div>
          <input type="range" min="0" max="1" step="0.01"
          className="pop-slider"
          value={local.threshold}
          onChange={(e) => save({ threshold: parseFloat(e.target.value) })} />
          <div className="pop-thr-row"><span>0.00</span><span>0.50</span><span>1.00</span></div>
        </div>

        <div className="pop-row">
          <div style={{ width: '100%' }}>
            <div className="pop-row-label">Action</div>
            <div className="pop-row-sub">Override the default action for this area only</div>
            <select className="pop-select" value={local.action || sig.default_action}
            onChange={(e) => save({ action: e.target.value })}>
              <option value="statistic">statistic — log only</option>
              <option value="notify">notify — send to queue</option>
              <option value="alarm">alarm — immediate escalation</option>
            </select>
          </div>
        </div>
      </div>
    </>);

}

// ─────────────────────────────────────────────────────────────────────────────
// Event drawer
function EventDrawer({ event, onClose, onSelectEvent, allEventsForArea }) {
  useEffect(() => {
    const onKey = (e) => {if (e.key === 'Escape') onClose();};
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!event) return null;
  const sig = signalById(event.signal_id);
  const area = areaById(event.area_id);

  // Threshold position on score bar
  const scorePct = Math.round(event.score * 100);
  const thrPct = Math.round(sig.default_threshold * 100);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drw-head">
          <div className="drw-title">
            <h3>{sig.text}</h3>
            <div className="crumb">{area.name} · {event.at_str} · Event {event.id}</div>
          </div>
          <div className="drw-close" onClick={onClose}>×</div>
        </div>

        <div className="drw-body">
          {/* Frame */}
          <div className="drw-section">
            <div className="drw-section-hd">Captured Frame</div>
            <div className="frame">
              <div className="frame-meta">
                <span className="rec">REC · CAM-{area.id.toUpperCase()}-01</span>
                <span>{event.at_str}:{String(Math.floor(Math.random() * 60)).padStart(2, '0')} · 1920×1080</span>
              </div>
              {event.bbox &&
              <div className="frame-bbox"
              data-label={sig.id + ' · ' + event.score.toFixed(2)}
              style={{
                left: event.bbox.x + '%', top: event.bbox.y + '%',
                width: event.bbox.w + '%', height: event.bbox.h + '%',
                borderColor: event.action === 'alarm' ? 'var(--sev-alarm)' : 'var(--sev-notify)'
              }} />
              }
            </div>
          </div>

          {/* Pipeline */}
          <div className="drw-section">
            <div className="drw-section-hd">Detection Pipeline</div>
            <div className="pipeline">
              <div className="pipe-step">
                <div className="lbl">1 · Embedder</div>
                <div className="val">{event.score.toFixed(3)}</div>
                <div className="sub">cosine similarity</div>
                <div className="score-bar">
                  <div className={"fill " + (event.score >= sig.default_threshold ? "over " : "") + event.action}
                  style={{ width: `${scorePct}%` }} />
                </div>
              </div>
              <div className="pipe-step">
                <div className="lbl">2 · Threshold</div>
                <div className="val">≥ {sig.default_threshold.toFixed(2)}</div>
                <div className="sub">{event.score >= sig.default_threshold ? 'passed' : 'below'}</div>
              </div>
              <div className="pipe-step">
                <div className="lbl">3 · Action</div>
                <div className="val" style={{ textTransform: 'capitalize' }}>{event.action}</div>
                <div className="sub">P{event.priority} · cooldown {sig.cooldown_sec}s</div>
              </div>
            </div>
          </div>

          {/* LLM */}
          {event.llm &&
          <div className="drw-section">
              <div className="drw-section-hd">Vision LLM Verdict · {event.llm.verdict}</div>
              <div className="llm-card">
                <div className="llm-card-hd">
                  <div className="who">
                    <div className="llm-avatar" />
                    <span>{event.llm.model}</span>
                  </div>
                  <div className="llm-card-meta">{event.llm.latency_ms}ms · conf {(event.llm.confidence * 100).toFixed(0)}%</div>
                </div>
                <div className="llm-card-body">
                  {event.llm.text.split('**').map((chunk, i) => i % 2 === 0 ?
                <React.Fragment key={i}>{chunk}</React.Fragment> :
                <strong key={i}>{chunk}</strong>
                ).reduce((acc, el, i, arr) => {
                  // group into paragraphs by period-followed-by-space
                  return acc.concat(el);
                }, []).length > 0 && <p>{event.llm.text.split('**').map((chunk, i) => i % 2 === 0 ?
                  <React.Fragment key={i}>{chunk}</React.Fragment> :
                  <strong key={i}>{chunk}</strong>
                  )}</p>}
                </div>
              </div>
            </div>
          }

          {event.note &&
          <div className="drw-section">
              <div className="drw-section-hd">Signal Note</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, lineHeight: 1.55 }}>
                {event.note}
              </div>
            </div>
          }

          {/* Timeline of other events for this area */}
          <div className="drw-section">
            <div className="drw-section-hd">Other Events · {area.name}</div>
            <div className="timeline-list">
              {allEventsForArea.filter((e) => e.id !== event.id).slice(-10).reverse().map((e) => {
                const s = signalById(e.signal_id);
                return (
                  <div key={e.id} className="tl-item" onClick={() => onSelectEvent(e)}>
                    <div className="tl-time">{e.at_str}</div>
                    <div className="tl-content">
                      <div className="tl-sig">{s.text}</div>
                      <div className="tl-sub">
                        <span className="tl-pill" data-sev={e.action}>{e.action}</span>
                        <span className="mono">score {e.score.toFixed(2)}</span>
                        <span>· P{s.priority}</span>
                      </div>
                    </div>
                  </div>);

              })}
            </div>
          </div>
        </div>
      </div>
    </>);

}

// ─────────────────────────────────────────────────────────────────────────────
// App
function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Filters
  const [areaFilter, setAreaFilter] = useState([]); // empty = all
  const [priorityFilter, setPriorityFilter] = useState([]);
  const [actionFilter, setActionFilter] = useState([]);

  // Timebar range — default 08:00–18:00
  const [range, setRange] = useState({ from: 8 * 60, to: 18 * 60 });

  // Drawer / popover
  const [drawerEvent, setDrawerEvent] = useState(null);
  const [popoverSignal, setPopoverSignal] = useState(null);

  // Sidebar (mobile)
  const [sideOpen, setSideOpen] = useState(false);

  // Per-area-signal overrides (local state)
  const [signalStates, setSignalStates] = useState({});

  // Apply theme + accent
  useEffect(() => {
    document.documentElement.classList.toggle('dark', !!tweaks.dark);
    document.documentElement.style.setProperty('--accent', tweaks.accent);
  }, [tweaks.dark, tweaks.accent]);

  // Density adjusts padding/gap (CSS var)
  useEffect(() => {
    const map = { compact: 10, comfy: 14, spacious: 18 };
    document.documentElement.style.setProperty('--grid-gap', (map[tweaks.density] || 14) + 'px');
  }, [tweaks.density]);

  // Filter events
  const filteredEvents = useMemo(() => {
    return EVENTS.filter((e) => {
      if (areaFilter.length && !areaFilter.includes(e.area_id)) return false;
      if (priorityFilter.length && !priorityFilter.includes(e.priority)) return false;
      if (actionFilter.length && !actionFilter.includes(e.action)) return false;
      return true;
    });
  }, [areaFilter, priorityFilter, actionFilter]);

  const inRange = filteredEvents.filter((e) => e.at >= range.from && e.at < range.to);

  const eventsByArea = useMemo(() => {
    const m = {};
    AREAS.forEach((a) => {m[a.id] = [];});
    filteredEvents.forEach((e) => {(m[e.area_id] ||= []).push(e);});
    return m;
  }, [filteredEvents]);

  const areaCounts = useMemo(() => {
    const c = {};
    filteredEvents.forEach((e) => {
      if (e.at >= range.from && e.at < range.to) c[e.area_id] = (c[e.area_id] || 0) + 1;
    });
    return c;
  }, [filteredEvents, range]);

  const eventsByHour = useMemo(() => {
    const m = {};
    for (let h = 0; h < 24; h++) m[h] = { total: 0, statistic: 0, notify: 0, alarm: 0 };
    filteredEvents.forEach((e) => {
      const h = Math.floor(e.at / 60);
      m[h].total += 1;
      m[h][e.action] += 1;
    });
    return m;
  }, [filteredEvents]);

  const visibleAreas = areaFilter.length ? AREAS.filter((a) => areaFilter.includes(a.id)) : AREAS;

  const onSignalChange = (areaId, sigId, state) => {
    setSignalStates((s) => ({ ...s, [`${areaId}:${sigId}`]: state }));
  };

  return (
    <div className="app">
      <Sidebar
        open={sideOpen}
        onCloseMobile={() => setSideOpen(false)}
        areaFilter={areaFilter} setAreaFilter={setAreaFilter}
        priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter}
        actionFilter={actionFilter} setActionFilter={setActionFilter}
        areaCounts={areaCounts} />
      
      <main className="main">
        <div className="topbar">
          <div className="topbar-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="menu-btn" onClick={() => setSideOpen(true)} aria-label="Menu">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h12" /></svg>
              </button>
              <div className="topbar-title">
                <h1>What happened today</h1>
                <div className="sub">{inRange.length} events across {visibleAreas.length} area{visibleAreas.length > 1 ? 's' : ''} · {fmtHM(range.from)}–{fmtHM(range.to)}</div>
              </div>
            </div>
            <div className="topbar-actions">
              <div className="tb-btn">Today <span className="k">T</span></div>
              <div className="tb-btn">Week</div>
              <div className="tb-btn">Export</div>
              <a className="tb-btn" href="Setup - Cameras & Zones.html" style={{ textDecoration: 'none' }}>
                <span className="mi" style={{ fontFamily: "'Material Symbols Rounded'", fontWeight: 500, fontStyle: 'normal', fontSize: 16, lineHeight: 1, fontFeatureSettings: "'liga'" }}>tune</span>
                Setup
              </a>
              <div className="tb-btn primary">Live view <span className="k">L</span></div>
            </div>
          </div>
        </div>

        <TimeBar range={range} setRange={setRange} eventsByHour={eventsByHour} totalEvents={inRange.length} />

        <div className="content">
          <div className="grid-head">
            <div className="grid-head-title">
              Areas <span className="meta">· {visibleAreas.length} visible</span>
            </div>
            <div className="grid-head-view">
              <div className="view-btn on">Grid</div>
              <div className="view-btn">List</div>
              <div className="view-btn">Floorplan</div>
            </div>
          </div>

          <div className="area-grid" style={{ gap: 'var(--grid-gap, 14px)' }}>
            {visibleAreas.map((a) =>
            <AreaTile key={a.id}
            area={a}
            events={eventsByArea[a.id] || []}
            range={range}
            onOpenEvent={setDrawerEvent}
            onOpenSignal={setPopoverSignal}
            signalStates={signalStates}
            tweaks={tweaks} />

            )}
          </div>
        </div>
      </main>

      {drawerEvent &&
      <EventDrawer
        event={drawerEvent}
        onClose={() => setDrawerEvent(null)}
        onSelectEvent={setDrawerEvent}
        allEventsForArea={eventsByArea[drawerEvent.area_id] || []} />

      }

      {popoverSignal &&
      <SignalPopover
        data={popoverSignal}
        onClose={() => setPopoverSignal(null)}
        onChange={onSignalChange} />

      }

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakToggle label="Dark mode" value={tweaks.dark} onChange={(v) => setTweak('dark', v)} />
        <TweakColor label="Accent color" value={tweaks.accent} onChange={(v) => setTweak('accent', v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={tweaks.density} options={['compact', 'comfy', 'spacious']} onChange={(v) => setTweak('density', v)} />
        <TweakSection label="Alerts" />
        <TweakToggle label="Animate alarm badges" value={tweaks.animateAlarms} onChange={(v) => setTweak('animateAlarms', v)} />
        <TweakToggle label="Show LLM escalation badges" value={tweaks.showLLMBadges} onChange={(v) => setTweak('showLLMBadges', v)} />
      </TweaksPanel>
    </div>);

}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);