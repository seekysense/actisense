const PRIORITIES = [1, 2, 3, 4, 5];
const ACTIONS = ["statistic", "notify", "alarm"];

export function Sidebar({
  open, onCloseMobile,
  areas, signals,
  areaFilter, setAreaFilter,
  priorityFilter, setPriorityFilter,
  actionFilter, setActionFilter,
  areaCounts,
  username, onLogout,
  wsStatus,
}) {
  const toggleArea = (id) =>
    setAreaFilter((f) => f.includes(id) ? f.filter((x) => x !== id) : [...f, id]);
  const togglePriority = (p) =>
    setPriorityFilter((f) => f.includes(p) ? f.filter((x) => x !== p) : [...f, p]);
  const toggleAction = (a) =>
    setActionFilter((f) => f.includes(a) ? f.filter((x) => x !== a) : [...f, a]);

  const totalCameras = areas.reduce((s, a) => s + (a.camera_count || a.cameras?.length || 0), 0);

  return (
    <>
      <div className={"sidebar-scrim " + (open ? "on" : "")} onClick={onCloseMobile} />
      <aside className={"sidebar " + (open ? "open" : "")}>
        <div className="site-card">
          <div className="site-brand">
            <div className="site-brand-dot" />
            <div>
              <div className="site-brand-name">ActiSense</div>
              <div className="site-brand-tag">Operations Console</div>
            </div>
          </div>
          <div className="site-select">
            <div>
              <div className="site-select-name">The Castelletto</div>
              <div className="site-select-meta">
                {areas.length} areas · {totalCameras} cameras
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className={"ws-chip " + wsStatus}
                title={`WebSocket: ${wsStatus}`}
              >
                <span className="ws-dot" />
                {wsStatus === "connected" ? "live" : wsStatus}
              </span>
              <div className="site-select-chev">▾</div>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">
            <span>Areas</span>
            <span className="count">
              {areaFilter.length === 0 ? "all" : `${areaFilter.length}/${areas.length}`}
            </span>
          </div>
          <div className="filter-list">
            {areas.map((a) => (
              <div
                key={a.id}
                className={"filter-item " + (areaFilter.includes(a.id) ? "on" : "")}
                onClick={() => toggleArea(a.id)}
              >
                <div className="filter-check" />
                <div className="filter-label">{a.name}</div>
                <div className="filter-meta">{areaCounts[a.id] || 0}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">
            <span>Priority</span>
            <span className="count">1 crit · 5 info</span>
          </div>
          <div className="pri-row">
            {PRIORITIES.map((p) => (
              <div
                key={p}
                className={"pri-btn p" + p + " " + (priorityFilter.includes(p) ? "on" : "")}
                onClick={() => togglePriority(p)}
              >
                P{p}
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-section" style={{ paddingBottom: 16 }}>
          <div className="sidebar-label"><span>Action</span></div>
          <div className="action-chips">
            {ACTIONS.map((a) => (
              <div
                key={a}
                data-sev={a}
                className={"action-chip " + (actionFilter.includes(a) ? "on" : "")}
                onClick={() => toggleAction(a)}
              >
                <span className="dot" />{a}
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-foot">
          <div className="avatar">{(username || "?").slice(0, 2).toUpperCase()}</div>
          <div className="who">
            <div className="who-name">{username || "User"}</div>
            <div className="who-role">Operator</div>
          </div>
          <button className="logout-btn" onClick={onLogout}>Out</button>
        </div>
      </aside>
    </>
  );
}
