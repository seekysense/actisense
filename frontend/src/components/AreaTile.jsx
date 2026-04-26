export function AreaTile({ area, events, range, signals, onOpenEvent, onOpenSignal, signalStates, onOpenArea }) {
  const inRange = events.filter((e) => e.at >= range.from && e.at < range.to);
  const alarms = inRange.filter((e) => e.action === "alarm").length;
  const notifies = inRange.filter((e) => e.action === "notify").length;

  let sev = "ok";
  if (alarms > 0) sev = "alarm";
  else if (notifies > 0) sev = "notify";
  else if (inRange.length > 0) sev = "statistic";

  const sevLabel = {
    ok: "Clear",
    statistic: "Normal",
    notify: `${notifies} notify`,
    alarm: `${alarms} alarm${alarms > 1 ? "s" : ""}`,
  }[sev];

  const bins = Array.from({ length: 24 }, () => ({ total: 0, sev: "idle" }));
  events.forEach((e) => {
    const h = Math.floor(e.at / 60);
    bins[h].total += 1;
    const rank = { idle: 0, statistic: 1, notify: 2, alarm: 3 };
    if (rank[e.action] > rank[bins[h].sev]) bins[h].sev = e.action;
  });
  const maxBin = Math.max(1, ...bins.map((b) => b.total));

  const latest = inRange[inRange.length - 1] || events[events.length - 1];

  const clipCount = new Set(inRange.map((e) => e.clip_path).filter(Boolean)).size;

  const areaSignals = (area.signals || []).map((as) => {
    const sig = signals.find((s) => s.id === as.signal_id);
    if (!sig) return null;
    const state = signalStates[`${area.id}:${as.signal_id}`] || {
      enabled: as.enabled !== false,
      threshold: as.threshold_override ?? sig.default_threshold,
      action: as.action_override ?? sig.default_action,
    };
    const count = inRange.filter((e) => e.signal_id === as.signal_id).length;
    return { as, sig, state, count };
  }).filter(Boolean);

  return (
    <div className={"tile sev-" + sev}>
      <div className="tile-head">
        <div className="tile-area">
          <h3 className="tile-area-name tile-area-link" onClick={() => onOpenArea?.(area)}>{area.name}</h3>
          <div className="tile-area-meta">
            <span>{area.camera_count || area.cameras?.length || 0} camera{(area.camera_count || area.cameras?.length || 0) !== 1 ? "s" : ""}</span>
          </div>
        </div>
        <div className="sev-badge" data-sev={sev}>
          <span className="pulse" />
          {sevLabel}
        </div>
      </div>

      <div className="tile-stats">
        <div className="stat">
          <div className="stat-v">{inRange.length}</div>
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
          const cls =
            b.total === 0
              ? "spark-b"
              : "spark-b " + (b.sev === "alarm" ? "alarm" : b.sev === "notify" ? "notify" : inSel ? "in-range" : "");
          return (
            <div
              key={i}
              className={cls}
              style={{
                height: b.total ? `${4 + b.total / maxBin * 22}px` : "2px",
                opacity: inSel || b.total === 0 ? 1 : 0.45,
              }}
            />
          );
        })}
      </div>

      <div className="tile-signals">
        <div className="tile-signals-hd">
          <span>Active Signals · {areaSignals.filter(({ count }) => count > 0).length}</span>
          {clipCount > 0 && (
            <span className="clips-count">{clipCount} clip{clipCount !== 1 ? "s" : ""}</span>
          )}
        </div>
        {areaSignals.filter(({ count }) => count > 0).map(({ as, sig, state, count }) => (
          <div key={sig.id} className={"sig " + (!state.enabled ? "disabled" : "")}>
            <div className={"sig-state " + (state.enabled ? "active " + sig.default_action : "off")} />
            <div className="sig-text" title={sig.text}>{sig.name || sig.id}</div>
            <div className="sig-meta">
              <span className={"count " + (count > 0 && sig.default_action !== "statistic" ? "hi" : "")}>
                {count}
              </span>
              <button
                className="sig-cog"
                aria-label="Configure signal"
                onClick={(e) => { e.stopPropagation(); onOpenSignal({ area, as, sig, state }); }}
              >
                <span className="mi">settings</span>
              </button>
            </div>
          </div>
        ))}
        {areaSignals.filter(({ count }) => count > 0).length === 0 && (
          <div style={{ fontSize: 12, color: "var(--ink-4)", padding: "4px 0" }}>No events in range</div>
        )}
      </div>
    </div>
  );
}
