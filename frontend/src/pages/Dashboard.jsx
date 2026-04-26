import { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "../api/client.js";
import { useAlerts } from "../hooks/useAlerts.js";
import { Sidebar } from "../components/Sidebar.jsx";
import { TimeBar } from "../components/TimeBar.jsx";
import { AreaTile } from "../components/AreaTile.jsx";
import { AreaDrawer } from "../components/AreaDrawer.jsx";
import { EventDrawer } from "../components/EventDrawer.jsx";
import { SignalPopover } from "../components/SignalPopover.jsx";

function toAt(timestamp) {
  const d = new Date(timestamp);
  return d.getHours() * 60 + d.getMinutes();
}

function atStr(timestamp) {
  return new Date(timestamp).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function adaptAlert(a) {
  const ts = a.timestamp || new Date().toISOString();
  const llm = a.llm_verdict?.confirmed
    ? { verdict: "confirmed", confidence: a.llm_verdict.confidence, text: a.llm_verdict.description, model: "claude-haiku-4-5", latency_ms: 0 }
    : a.llm_verdict_confirmed
    ? { verdict: "confirmed", confidence: a.llm_verdict_confidence, text: a.llm_verdict_description, model: "claude-haiku-4-5", latency_ms: 0 }
    : null;
  return {
    id: a.event_id,
    area_id: a.area_id,
    signal_id: a.signal_id,
    camera_id: a.camera_id || null,
    at: toAt(ts),
    at_str: atStr(ts),
    score: a.score,
    action: a.action,
    priority: a.priority || 3,
    llm,
    timestamp: ts,
    clip_path: a.clip_path || null,
  };
}

function startOfDay(d) {
  const nd = new Date(d);
  nd.setHours(0, 0, 0, 0);
  return nd;
}

function addDays(d, n) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function getWeekRange(d) {
  const day = d.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = addDays(d, diffToMon);
  const sun = addDays(mon, 6);
  return { from: startOfDay(mon), to: startOfDay(sun) };
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatDate(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatDateShort(d) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function toISODate(d) {
  // Use local date components to avoid UTC offset shifting the day
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function Dashboard({ username, onLogout }) {
  const [config, setConfig] = useState(null);
  const [historicEvents, setHistoricEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [areaFilter, setAreaFilter] = useState([]);
  const [priorityFilter, setPriorityFilter] = useState([]);
  const [actionFilter, setActionFilter] = useState([]);
  const [range, setRange] = useState({ from: 8 * 60, to: 18 * 60 });
  const [drawerEvent, setDrawerEvent] = useState(null);
  const [drawerArea, setDrawerArea] = useState(null);
  const [popoverSignal, setPopoverSignal] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [signalStates, setSignalStates] = useState({});

  // Date navigation state
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [viewMode, setViewMode] = useState("day"); // "day" | "week"

  const { alerts: liveAlerts, wsStatus } = useAlerts(100);

  // Compute the displayed date range
  const dateRange = useMemo(() => {
    if (viewMode === "week") {
      return getWeekRange(selectedDate);
    }
    return { from: selectedDate, to: selectedDate };
  }, [selectedDate, viewMode]);

  const today = useMemo(() => startOfDay(new Date()), []);

  const isViewingToday = useMemo(() => {
    if (viewMode === "day") return isSameDay(selectedDate, today);
    const wr = getWeekRange(selectedDate);
    return wr.from <= today && today <= wr.to;
  }, [selectedDate, viewMode, today]);

  // Load config once
  useEffect(() => {
    api.getConfig()
      .then(cfg => setConfig(cfg))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Reload events when date range changes
  useEffect(() => {
    setEventsLoading(true);
    api.getEvents({
      limit: 1000,
      dateFrom: toISODate(dateRange.from),
      dateTo: toISODate(dateRange.to),
    })
      .then(evRes => setHistoricEvents((evRes.events || []).map(adaptAlert)))
      .catch(console.error)
      .finally(() => setEventsLoading(false));
  }, [toISODate(dateRange.from), toISODate(dateRange.to)]);

  const liveAdapted = useMemo(() => liveAlerts.map(adaptAlert), [liveAlerts]);

  const allEvents = useMemo(() => {
    if (!isViewingToday) return historicEvents;
    const ids = new Set(historicEvents.map((e) => e.id));
    const liveFiltered = liveAdapted.filter((e) => {
      if (ids.has(e.id)) return false;
      // only include live alerts matching the current date range
      const evDay = startOfDay(new Date(e.timestamp));
      return evDay >= dateRange.from && evDay <= dateRange.to;
    });
    return [...liveFiltered, ...historicEvents];
  }, [liveAdapted, historicEvents, isViewingToday, dateRange]);

  const areas = config?.areas || [];
  const signals = config?.signals || [];

  const filteredEvents = useMemo(() => {
    return allEvents.filter((e) => {
      if (areaFilter.length && !areaFilter.includes(e.area_id)) return false;
      if (priorityFilter.length && !priorityFilter.includes(e.priority)) return false;
      if (actionFilter.length && !actionFilter.includes(e.action)) return false;
      return true;
    });
  }, [allEvents, areaFilter, priorityFilter, actionFilter]);

  const inRange = filteredEvents.filter((e) => e.at >= range.from && e.at < range.to);

  const eventsByArea = useMemo(() => {
    const m = {};
    areas.forEach((a) => { m[a.id] = []; });
    filteredEvents.forEach((e) => { (m[e.area_id] = m[e.area_id] || []).push(e); });
    return m;
  }, [filteredEvents, areas]);

  const areaCounts = useMemo(() => {
    const c = {};
    filteredEvents.forEach((e) => {
      if (e.at >= range.from && e.at < range.to)
        c[e.area_id] = (c[e.area_id] || 0) + 1;
    });
    return c;
  }, [filteredEvents, range]);

  const eventsByHour = useMemo(() => {
    const m = {};
    for (let h = 0; h < 24; h++) m[h] = { total: 0, statistic: 0, notify: 0, alarm: 0 };
    filteredEvents.forEach((e) => {
      const h = Math.floor(e.at / 60);
      if (m[h]) { m[h].total += 1; m[h][e.action] = (m[h][e.action] || 0) + 1; }
    });
    return m;
  }, [filteredEvents]);

  const visibleAreas = areaFilter.length ? areas.filter((a) => areaFilter.includes(a.id)) : areas;

  const onSignalChange = useCallback((areaId, sigId, state) => {
    setSignalStates((s) => ({ ...s, [`${areaId}:${sigId}`]: state }));
  }, []);

  // Navigation handlers
  const goToPrev = useCallback(() => {
    if (viewMode === "week") {
      setSelectedDate(d => addDays(d, -7));
    } else {
      setSelectedDate(d => addDays(d, -1));
    }
  }, [viewMode]);

  const goToNext = useCallback(() => {
    if (viewMode === "week") {
      setSelectedDate(d => addDays(d, 7));
    } else {
      setSelectedDate(d => addDays(d, 1));
    }
  }, [viewMode]);

  const goToToday = useCallback(() => {
    setSelectedDate(startOfDay(new Date()));
  }, []);

  const toggleWeekView = useCallback(() => {
    setViewMode(v => v === "week" ? "day" : "week");
  }, []);

  // Week day pills (for week view)
  const weekDays = useMemo(() => {
    if (viewMode !== "week") return [];
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(dateRange.from, i);
      const count = filteredEvents.filter(e => {
        const ed = new Date(e.timestamp);
        return isSameDay(ed, d) && e.at >= range.from && e.at < range.to;
      }).length;
      days.push({ date: d, count });
    }
    return days;
  }, [viewMode, dateRange.from, filteredEvents, range]);

  // Title
  const titleText = useMemo(() => {
    if (viewMode === "week") {
      return `${formatDateShort(dateRange.from)} – ${formatDateShort(dateRange.to)}`;
    }
    if (isSameDay(selectedDate, today)) return "What happened today";
    return `What happened on ${formatDate(selectedDate)}`;
  }, [viewMode, selectedDate, dateRange, today]);

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="app">
      <Sidebar
        open={sideOpen}
        onCloseMobile={() => setSideOpen(false)}
        areas={areas}
        signals={signals}
        areaFilter={areaFilter} setAreaFilter={setAreaFilter}
        priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter}
        actionFilter={actionFilter} setActionFilter={setActionFilter}
        areaCounts={areaCounts}
        username={username}
        onLogout={onLogout}
        wsStatus={wsStatus}
      />

      <main className="main">
        <div className="topbar">
          <div className="topbar-row">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="menu-btn" onClick={() => setSideOpen(true)} aria-label="Menu">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 4h12M2 8h12M2 12h12" />
                </svg>
              </button>
              <div className="topbar-title">
                <h1>{titleText}{eventsLoading && <span className="loading-dot"> …</span>}</h1>
                <div className="sub">
                  {inRange.length} events across {visibleAreas.length} area{visibleAreas.length !== 1 ? "s" : ""}
                </div>
              </div>
            </div>
            <div className="topbar-actions">
              <div className="date-nav">
                <button className="date-nav-btn" onClick={goToPrev} title={viewMode === "week" ? "Previous week" : "Previous day"}>‹</button>
                <span className="date-nav-label">
                  {viewMode === "week"
                    ? `${formatDateShort(dateRange.from)} – ${formatDateShort(dateRange.to)}`
                    : formatDate(selectedDate)}
                </span>
                <button className="date-nav-btn" onClick={goToNext} title={viewMode === "week" ? "Next week" : "Next day"}>›</button>
              </div>
              {!isViewingToday && (
                <button className="tb-btn" onClick={goToToday}>Today</button>
              )}
              <button
                className={`tb-btn${viewMode === "week" ? " primary" : ""}`}
                onClick={toggleWeekView}
              >
                Week
              </button>
              {isViewingToday && <div className="tb-btn primary">Live</div>}
            </div>
          </div>

          {viewMode === "week" && weekDays.length > 0 && (
            <div className="week-pills">
              {weekDays.map(({ date: d, count }) => (
                <button
                  key={d.toISOString()}
                  className={`week-pill${isSameDay(d, selectedDate) ? " active" : ""}${isSameDay(d, today) ? " today" : ""}`}
                  onClick={() => { setSelectedDate(startOfDay(d)); setViewMode("day"); }}
                >
                  <span className="week-pill-day">{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                  <span className="week-pill-date">{d.getDate()}</span>
                  {count > 0 && <span className="week-pill-count">{count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <TimeBar
          range={range}
          setRange={setRange}
          eventsByHour={eventsByHour}
          totalEvents={inRange.length}
        />

        <div className="content">
          <div className="grid-head">
            <div className="grid-head-title">
              Areas <span className="meta">· {visibleAreas.length} visible</span>
            </div>
            <div className="grid-head-view">
              <div className="view-btn on">Grid</div>
            </div>
          </div>

          {visibleAreas.length === 0 ? (
            <div className="empty-state">No areas configured. Check your site.yaml.</div>
          ) : (
            <div className="area-grid">
              {visibleAreas.map((a) => (
                <AreaTile
                  key={a.id}
                  area={a}
                  events={eventsByArea[a.id] || []}
                  range={range}
                  signals={signals}
                  onOpenEvent={setDrawerEvent}
                  onOpenSignal={setPopoverSignal}
                  onOpenArea={setDrawerArea}
                  signalStates={signalStates}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {drawerArea && !drawerEvent && (
        <AreaDrawer
          area={drawerArea}
          events={eventsByArea[drawerArea.id] || []}
          signals={signals}
          range={range}
          onClose={() => setDrawerArea(null)}
          onOpenEvent={(e) => { setDrawerEvent(e); setDrawerArea(null); }}
        />
      )}

      {drawerEvent && (
        <EventDrawer
          event={drawerEvent}
          onClose={() => setDrawerEvent(null)}
          onSelectEvent={setDrawerEvent}
          allEventsForArea={eventsByArea[drawerEvent.area_id] || []}
          signals={signals}
        />
      )}

      {popoverSignal && (
        <SignalPopover
          data={popoverSignal}
          onClose={() => setPopoverSignal(null)}
          onChange={onSignalChange}
        />
      )}
    </div>
  );
}
