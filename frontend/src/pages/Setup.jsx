import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── API helpers ──────────────────────────────────────────────────────────────
const BASE_URL = import.meta.env.VITE_API_URL || '';
const getToken = () => localStorage.getItem('vsa_token');

async function req(path, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...opts, headers });
  if (res.status === 401) {
    localStorage.removeItem('vsa_token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

const setupApi = {
  getCameras: () => req('/api/config/cameras'),
  createCamera: (b) => req('/api/config/cameras', { method: 'POST', body: JSON.stringify(b) }),
  patchCamera: (id, b) => req(`/api/config/cameras/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteCamera: (id) => req(`/api/config/cameras/${id}`, { method: 'DELETE' }),
  async getSnapshot(id) {
    const res = await fetch(`${BASE_URL}/api/config/cameras/${id}/snapshot`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  getAreas: () => req('/api/config/areas'),
  getSignals: () => req('/api/config/signals'),
  createSignal: (b) => req('/api/config/signals', { method: 'POST', body: JSON.stringify(b) }),
  patchSignal: (id, b) => req(`/api/config/signals/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteSignal: (id) => req(`/api/config/signals/${id}`, { method: 'DELETE' }),
  suggestPhrase: (b) => req('/api/setup/signal/suggest-phrase', { method: 'POST', body: JSON.stringify(b) }),
  async uploadClip(label, file) {
    const form = new FormData();
    form.append('label', label);
    form.append('file', file);
    return req('/api/setup/signal/upload-clip', { method: 'POST', body: form });
  },
  captureClip: (b) => req('/api/setup/signal/capture-clip', { method: 'POST', body: JSON.stringify(b) }),
  async calibrateSSE(body, onEvent) {
    const res = await fetch(`${BASE_URL}/api/setup/signal/calibrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const ln of lines) {
        if (ln.startsWith('data: ')) {
          try { onEvent(JSON.parse(ln.slice(6))); } catch { /* ignore */ }
        }
      }
    }
  },
  deleteClip: (id) => req(`/api/setup/signal/clips/${id}`, { method: 'DELETE' }),
  getPrompts: () => req('/api/config/prompts'),
  getPromptDetail: (key) => req(`/api/config/prompts/${encodeURIComponent(key)}`),
  patchPrompt: (key, b) => req(`/api/config/prompts/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(b) }),
};

// ─── Zone format conversions ─────────────────────────────────────────────────
function apiZoneToDesign(z, i) {
  return {
    id: `z${i}_${Math.random().toString(36).slice(2, 5)}`,
    name: z.name,
    type: z.exclude ? 'exclude' : 'include',
    rotation: z.rotation || 0,
    perspective: !!(z.perspective_quad),
    quad: z.perspective_quad ? z.perspective_quad.map(([x, y]) => ({ x, y })) : null,
    points: (z.polygon || []).map(([x, y]) => ({ x, y })),
  };
}

function designZoneToApi(z) {
  return {
    name: z.name,
    polygon: z.points.map(p => [p.x, p.y]),
    exclude: z.type === 'exclude',
    rotation: z.rotation || 0,
    ...(z.perspective && z.quad ? { perspective_quad: z.quad.map(p => [p.x, p.y]) } : {}),
  };
}

function camZones(cam) {
  return (cam?.preprocessing?.roi?.zones || []).map(apiZoneToDesign);
}

// ─── Geometry helpers ────────────────────────────────────────────────────────
const centroid = (pts) =>
  pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });

const bbox = (pts) => {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

const SNAP_PX = 12;
const ID_RE = /^[a-z0-9_-]*$/;
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

// ─── TopNav ───────────────────────────────────────────────────────────────────
function TopNav({ username, onLogout, onHome, breadcrumb }) {
  return (
    <div className="setup-topnav">
      <div className="setup-topnav-left">
        <button className="setup-topnav-back" onClick={onHome}>
          <span className="mi">arrow_back</span>Dashboard
        </button>
        <span className="setup-topnav-title">
          IQFrame
          <span className="setup-topnav-crumb">/ Setup{breadcrumb ? ` / ${breadcrumb}` : ''}</span>
        </span>
      </div>
      <div className="setup-topnav-right">
        <div className="setup-topnav-user">
          <div className="avatar">{(username || '?').slice(0, 2).toUpperCase()}</div>
          <span>{username}</span>
        </div>
        <button className="setup-topnav-logout" onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}

// ─── Landing ─────────────────────────────────────────────────────────────────
function Landing({ camerasCount, signalsCount, onPick }) {
  const navigate = useNavigate();
  return (
    <div className="setup-page">
      <div className="setup-breadcrumb"><span className="current">Setup</span></div>
      <div className="setup-page-head">
        <div>
          <h1 className="setup-page-title">Setup environment</h1>
          <p className="setup-page-sub">Configure cameras, zones, and detection signals for this site.</p>
        </div>
      </div>
      <div className="setup-landing-grid">
        <div className="setup-landing-card" onClick={() => onPick('cameras')}>
          <div className="setup-lc-icon"><span className="mi">videocam</span></div>
          <h3>Cameras</h3>
          <p>Configure IP cameras, set up native Axis analytics, and draw the regions of interest the embedder should focus on.</p>
          <div className="setup-lc-foot">
            <span className="setup-count-badge">{camerasCount} cameras configured</span>
            <button className="tb-btn">Manage Cameras<span className="mi">arrow_forward</span></button>
          </div>
        </div>
        <div className="setup-landing-card" onClick={() => onPick('signals')}>
          <div className="setup-lc-icon"><span className="mi">graph_3</span></div>
          <h3>Signals</h3>
          <p>Define detection signals in natural language with AI-guided calibration. Each signal can be tested against positive and negative example clips.</p>
          <div className="setup-lc-foot">
            <span className="setup-count-badge">{signalsCount} signals in library</span>
            <button className="tb-btn">Manage Signals<span className="mi">arrow_forward</span></button>
          </div>
        </div>
        <div className="setup-landing-card" onClick={() => onPick('site')}>
          <div className="setup-lc-icon"><span className="mi">settings</span></div>
          <h3>Site settings</h3>
          <p>Edit site metadata and review area camera assignments.</p>
          <div className="setup-lc-foot" style={{ justifyContent: 'flex-end' }}>
            <button className="tb-btn">Open settings<span className="mi">arrow_forward</span></button>
          </div>
        </div>
        <div className="setup-landing-card" onClick={() => navigate('/logs')}>
          <div className="setup-lc-icon"><span className="mi">terminal</span></div>
          <h3>Engine Logs</h3>
          <p>Monitor recent processing activity: clip scoring, LLM decisions, camera polling errors, and suppressed events — updated every 10 seconds.</p>
          <div className="setup-lc-foot" style={{ justifyContent: 'flex-end' }}>
            <button className="tb-btn">View Logs<span className="mi">arrow_forward</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CameraList ───────────────────────────────────────────────────────────────
function CameraList({ cameras, onBack, onNew, onEdit, onRoi, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(null);
  return (
    <div className="setup-page">
      <div className="setup-breadcrumb">
        <button onClick={onBack}>Setup</button><span className="sep">/</span>
        <span className="current">Cameras</span>
      </div>
      <div className="setup-page-head">
        <div>
          <h1 className="setup-page-title">Cameras</h1>
          <p className="setup-page-sub">{cameras.length} cameras · click ROI Editor to draw or refine zones.</p>
        </div>
        <button className="tb-btn primary" onClick={onNew}><span className="mi">add</span>Add Camera</button>
      </div>
      {cameras.length === 0 ? (
        <div className="setup-empty">
          <span className="mi">videocam_off</span>
          No cameras configured yet — click <strong>Add Camera</strong> to start.
        </div>
      ) : (
        <div className="setup-cam-list">
          {cameras.map(c => {
            const zoneCount = (c.preprocessing?.roi?.zones || []).length;
            return (
              <div key={c.id} className="setup-cam-card">
                <div>
                  <div className="setup-cam-id-row">
                    <span className="setup-cam-id">{c.id}</span>
                    {c.axis_ip && <span className="setup-ip-chip"><span className="mi" style={{ fontSize: 11 }}>lan</span>{c.axis_ip}</span>}
                    <span className="setup-area-chip">{c.area}</span>
                  </div>
                  <h3 className="setup-cam-name">{c.name}</h3>
                  <div className="setup-cam-meta">
                    <span>{zoneCount} zone{zoneCount === 1 ? '' : 's'} configured</span>
                    {c.axis_event_id && <><span style={{ opacity: 0.4 }}>·</span><span>event: <code>{c.axis_event_id}</code></span></>}
                    {c.native_analytics?.people_counting && <><span style={{ opacity: 0.4 }}>·</span><span>people counting</span></>}
                  </div>
                </div>
                <div className="setup-cam-actions">
                  <button className="tb-btn" onClick={() => onEdit(c.id)}><span className="mi">edit</span>Edit</button>
                  <button className="tb-btn primary" onClick={() => onRoi(c.id)}>ROI Editor<span className="mi">arrow_forward</span></button>
                  {confirmDel === c.id ? (
                    <Fragment>
                      <button className="tb-btn" onClick={() => setConfirmDel(null)}>Cancel</button>
                      <button className="tb-btn" style={{ color: 'var(--sev-alarm)', borderColor: 'var(--sev-alarm)' }}
                        onClick={() => { onDelete(c.id); setConfirmDel(null); }}>
                        <span className="mi">delete</span>Confirm
                      </button>
                    </Fragment>
                  ) : (
                    <button className="tb-btn" style={{ color: 'var(--sev-alarm)' }} onClick={() => setConfirmDel(c.id)}>
                      <span className="mi">delete</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── CameraForm ───────────────────────────────────────────────────────────────
function CameraForm({ initial, mode, areas, onCancel, onSave, saving, error }) {
  const [c, setC] = useState(() => ({
    id: '', name: '', area: areas[0]?.id || '', axis_ip: '', axis_event_id: '', native_analytics: {},
    ...(initial || {}),
  }));
  const set = k => e => setC(s => ({ ...s, [k]: e.target.value }));
  const isEdit = mode === 'edit';
  const idOk = isEdit || (c.id.length >= 3 && ID_RE.test(c.id));
  const ipOk = !c.axis_ip || IP_RE.test(c.axis_ip);
  const nameOk = c.name.length >= 2;
  const canSave = nameOk && ipOk && idOk && !saving;
  const peopleCounting = !!(c.native_analytics?.people_counting);

  return (
    <div className="setup-page">
      <div className="setup-breadcrumb">
        <button onClick={onCancel}>Setup</button><span className="sep">/</span>
        <button onClick={onCancel}>Cameras</button><span className="sep">/</span>
        <span className="current">{isEdit ? c.id : 'New camera'}</span>
      </div>
      <div className="setup-page-head">
        <div>
          <h1 className="setup-page-title">{isEdit ? 'Edit camera' : 'Add camera'}</h1>
          <p className="setup-page-sub">Set network parameters and Axis event hooks for this camera.</p>
        </div>
      </div>
      <div className="setup-form-card">
        {error && (
          <div style={{ color: 'var(--sev-alarm)', fontSize: 13, marginBottom: 12, padding: '8px 10px', border: '1px solid', borderRadius: 6, background: 'var(--sev-alarm-bg)' }}>
            {error}
          </div>
        )}
        {!isEdit && (
          <div className="setup-form-row">
            <label className="setup-form-label">Camera ID</label>
            <input className="setup-form-input mono" value={c.id} placeholder="cam_kitchen_01"
              onChange={e => { const v = e.target.value.toLowerCase(); if (ID_RE.test(v)) setC(s => ({ ...s, id: v })); }} />
            <span className="setup-form-hint">Lowercase, digits, dashes and underscores only.</span>
          </div>
        )}
        <div className="setup-form-row">
          <label className="setup-form-label">Display name</label>
          <input className="setup-form-input" value={c.name} onChange={set('name')} placeholder="Ager Patris Lounge" />
        </div>
        <div className="setup-form-row split">
          <div>
            <label className="setup-form-label">Area</label>
            <select className="setup-form-select" value={c.area} onChange={set('area')} disabled={isEdit}>
              {areas.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
          </div>
          <div>
            <label className="setup-form-label">Axis IP</label>
            <input className="setup-form-input mono" value={c.axis_ip || ''} onChange={set('axis_ip')} placeholder="10.46.67.5" />
            {c.axis_ip && !ipOk && <span className="setup-form-hint" style={{ color: 'var(--sev-alarm)' }}>Invalid IPv4 address</span>}
          </div>
        </div>
        <div className="setup-form-row">
          <label className="setup-form-label">Axis Event ID <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>· optional</span></label>
          <input className="setup-form-input mono" value={c.axis_event_id || ''} onChange={set('axis_event_id')} placeholder="cabinet" />
          <span className="setup-form-hint">Trigger event name configured on the Axis device.</span>
        </div>
        <div className="setup-toggle-row">
          <div className="setup-toggle-row-text">
            <span className="setup-toggle-label">People counting</span>
            <span className="setup-toggle-hint">Enable <code>native_analytics.people_counting</code> on this camera.</span>
          </div>
          <div className={`setup-sw ${peopleCounting ? 'on' : ''}`}
            onClick={() => setC(s => ({ ...s, native_analytics: { ...s.native_analytics, people_counting: !peopleCounting } }))} />
        </div>
        <div className="setup-form-foot">
          <button className="tb-btn" onClick={onCancel}>Cancel</button>
          <button className="tb-btn primary" disabled={!canSave} onClick={() => onSave(c)}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : (
              <Fragment>Save & continue to ROI Editor<span className="mi">arrow_forward</span></Fragment>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RoiEditor ────────────────────────────────────────────────────────────────
function RoiEditor({ camera, initialZones, onSave, onCancel }) {
  const [zones, setZones] = useState(initialZones);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('select');
  const [draft, setDraft] = useState(null);
  const [pendingZone, setPendingZone] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [snapshotUrl, setSnapshotUrl] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [previewZone, setPreviewZone] = useState(null);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState({ w: 1000, h: 600 });
  const dragRef = useRef(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        if (pendingZone) setPendingZone(null);
        else if (draft) setDraft(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingZone, draft]);

  const loadSnapshot = async () => {
    if (!camera.axis_ip) { setToast('No IP configured for this camera'); return; }
    setSnapshotLoading(true);
    try {
      const url = await setupApi.getSnapshot(camera.id);
      if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
      setSnapshotUrl(url);
    } catch (err) {
      setToast(`Snapshot failed: ${err.message}`);
    }
    setSnapshotLoading(false);
  };

  // All coordinates stored in 1920×1080 pixel space (camera frame resolution).
  // SVG uses viewBox="0 0 1920 1080" + preserveAspectRatio="xMidYMid meet" so
  // getScreenCTM gives the correct inverse transform for drawing.
  const toPct = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const sp = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.max(0, Math.min(1920, sp.x)), y: Math.max(0, Math.min(1080, sp.y)) };
  }, []);

  // Scale factor: SVG units per screen pixel (for snap threshold and handle radius)
  const svgScale = Math.min(size.w / 1920, size.h / 1080);
  const ptRadius = Math.max(5, Math.round(5 / Math.max(svgScale, 0.01)));
  const snapThresh = Math.max(10, Math.round(12 / Math.max(svgScale, 0.01)));

  const onPointDown = (zoneId, idx, isQuad) => e => {
    if (mode !== 'select') return;
    e.stopPropagation();
    dragRef.current = { zoneId, idx, isQuad };
    setSelectedId(zoneId);
    e.target.setPointerCapture?.(e.pointerId);
  };

  const onSvgPointerMove = e => {
    if (dragRef.current) {
      const pos = toPct(e.clientX, e.clientY);
      const { zoneId, idx, isQuad } = dragRef.current;
      setZones(prev => prev.map(z => {
        if (z.id !== zoneId) return z;
        const key = isQuad ? 'quad' : 'points';
        return { ...z, [key]: (z[key] || []).map((p, i) => i === idx ? pos : p) };
      }));
    } else if (mode === 'draw' && draft) {
      const pos = toPct(e.clientX, e.clientY);
      const first = draft.points[0];
      const snapFirst = draft.points.length >= 3 && first && Math.hypot(pos.x - first.x, pos.y - first.y) < snapThresh;
      setDraft({ ...draft, hoverPos: pos, snapFirst });
    }
  };

  const onSvgClick = e => {
    if (mode !== 'draw') {
      if (e.target.tagName === 'svg') setSelectedId(null);
      return;
    }
    const pos = toPct(e.clientX, e.clientY);
    if (!draft) { setDraft({ points: [pos], hoverPos: null, snapFirst: false }); return; }
    const first = draft.points[0];
    if (draft.points.length >= 3 && first && Math.hypot(pos.x - first.x, pos.y - first.y) < snapThresh) {
      setPendingZone({ points: draft.points });
      setDraft(null);
      return;
    }
    setDraft({ ...draft, points: [...draft.points, pos] });
  };

  const addZone = (name, type) => {
    if (!pendingZone) return;
    const id = 'z_' + Math.random().toString(36).slice(2, 7);
    setZones(prev => [...prev, { id, name: name || 'zone', type, rotation: 0, perspective: false, quad: null, points: pendingZone.points }]);
    setSelectedId(id);
    setPendingZone(null);
    setMode('select');
    setToast(`Zone "${name}" added`);
  };

  const updateZone = (id, patch) => setZones(prev => prev.map(z => z.id === id ? { ...z, ...patch } : z));
  const deleteZone = id => { setZones(prev => prev.filter(z => z.id !== id)); if (selectedId === id) setSelectedId(null); };
  const togglePerspective = z => {
    if (z.perspective) return updateZone(z.id, { perspective: false, quad: null });
    const bb = bbox(z.points);
    updateZone(z.id, {
      perspective: true,
      quad: [{ x: bb.x, y: bb.y }, { x: bb.x + bb.w, y: bb.y }, { x: bb.x + bb.w, y: bb.y + bb.h }, { x: bb.x, y: bb.y + bb.h }],
    });
  };

  // Coordinates are already in 1920×1080 space — no conversion needed.
  const ptsToSvg = pts => pts.map(p => `${p.x},${p.y}`).join(' ');

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(zones.map(designZoneToApi));
      setToast('ROI saved');
    } catch (err) {
      setToast(`Save failed: ${err.message}`);
    }
    setSaving(false);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px 28px 0', boxSizing: 'border-box' }}>
      <div className="setup-breadcrumb">
        <button onClick={onCancel}>Setup</button><span className="sep">/</span>
        <button onClick={onCancel}>Cameras</button><span className="sep">/</span>
        <span className="current">ROI Editor</span>
      </div>
      <div className="setup-page-head">
        <div>
          <h1 className="setup-page-title">ROI Editor — {camera.name}</h1>
          <p className="setup-page-sub"><code>{camera.id}</code> · {camera.area} · {camera.axis_ip || 'no IP'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="tb-btn" onClick={onCancel}>Cancel</button>
          <button className="tb-btn primary" onClick={handleSave} disabled={saving}>
            <span className="mi">save</span>{saving ? 'Saving…' : 'Save ROI'}
          </button>
        </div>
      </div>

      <div className="setup-roi-shell">
        <div className="setup-roi-canvas-pane">
          <div className="setup-roi-toolbar">
            <button className="tb-btn" onClick={loadSnapshot} disabled={snapshotLoading}>
              <span className="mi">photo_camera</span>{snapshotLoading ? 'Loading…' : 'Get snapshot'}
            </button>
            <div className="setup-mode-toggle">
              <div className={`setup-mode-btn ${mode === 'draw' ? 'on' : ''}`} onClick={() => setMode('draw')}>
                <span className="mi">draw</span>Draw polygon
              </div>
              <div className={`setup-mode-btn ${mode === 'select' ? 'on' : ''}`} onClick={() => { setMode('select'); setDraft(null); }}>
                <span className="mi">arrow_selector_tool</span>Select / move
              </div>
            </div>
          </div>
          <div className="setup-roi-canvas-wrap" ref={wrapRef}>
            {snapshotUrl
              ? <img src={snapshotUrl} className="setup-roi-snapshot" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} alt="" />
              : <div className="setup-roi-noimg"><div><span className="mi">image_not_supported</span><br />Click <strong>Get snapshot</strong> to load the camera view</div></div>
            }
            <svg className={`setup-roi-svg ${mode === 'select' ? 'select-mode' : ''}`}
              ref={svgRef}
              viewBox="0 0 1920 1080" width={size.w} height={size.h}
              preserveAspectRatio="xMidYMid meet"
              onClick={onSvgClick} onPointerMove={onSvgPointerMove} onPointerUp={() => { dragRef.current = null; }}>
              {zones.map(z => {
                const isSel = z.id === selectedId;
                const dim = selectedId && !isSel;
                const c = centroid(z.points);
                return (
                  <g key={z.id} transform={z.rotation ? `rotate(${z.rotation} ${c.x} ${c.y})` : undefined}>
                    <polygon
                      className={`setup-roi-zone-fill ${z.type === 'exclude' ? 'exclude' : ''} ${isSel ? 'selected' : ''} ${dim ? 'dim' : ''}`}
                      points={ptsToSvg(z.points)}
                      vectorEffect="non-scaling-stroke"
                      onClick={e => { if (mode === 'select') { e.stopPropagation(); setSelectedId(z.id); } }} />
                    {z.perspective && z.quad && <polygon className="setup-roi-quad" points={ptsToSvg(z.quad)} vectorEffect="non-scaling-stroke" />}
                    <text className="setup-roi-zone-label" x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle" fontSize={ptRadius * 2.2}>{z.name}</text>
                    {isSel && mode === 'select' && z.points.map((p, i) => (
                      <circle key={i} className={`setup-roi-pt ${z.type === 'exclude' ? 'exclude' : ''}`} cx={p.x} cy={p.y} r={ptRadius} onPointerDown={onPointDown(z.id, i, false)} />
                    ))}
                    {isSel && mode === 'select' && z.perspective && z.quad && z.quad.map((p, i) => (
                      <circle key={'q' + i} className="setup-roi-pt quad" cx={p.x} cy={p.y} r={ptRadius} onPointerDown={onPointDown(z.id, i, true)} />
                    ))}
                  </g>
                );
              })}
              {draft && (
                <g>
                  {draft.points.length > 1 && <polyline points={ptsToSvg(draft.points)} className="setup-roi-draft-line" vectorEffect="non-scaling-stroke" />}
                  {draft.hoverPos && draft.points.length > 0 && (
                    <line className="setup-roi-draft-line"
                      vectorEffect="non-scaling-stroke"
                      x1={draft.points[draft.points.length - 1].x} y1={draft.points[draft.points.length - 1].y}
                      x2={draft.hoverPos.x} y2={draft.hoverPos.y} />
                  )}
                  {draft.points.map((p, i) => {
                    const isFirst = i === 0 && draft.points.length >= 3;
                    return (
                      <circle key={i}
                        className={`setup-roi-pt ${isFirst ? 'first-pt' : ''} ${draft.snapFirst && isFirst ? 'snap' : ''}`}
                        cx={p.x} cy={p.y} r={isFirst && draft.snapFirst ? ptRadius * 1.6 : ptRadius} />
                    );
                  })}
                </g>
              )}
            </svg>
          </div>
          <div className="setup-roi-foot">
            {mode === 'draw' && !draft && <span><span className="mi" style={{ fontSize: 14 }}>tips_and_updates</span> Click on the canvas to place the first point.</span>}
            {mode === 'draw' && draft && draft.points.length < 3 && <span>Place at least 3 points. Press <code>Esc</code> to cancel.</span>}
            {mode === 'draw' && draft && draft.points.length >= 3 && <span>Click the first point to close the polygon.</span>}
            {mode === 'select' && !selectedId && <span>Click a zone to select. Drag points to reshape.</span>}
            {mode === 'select' && selectedId && <span>Drag any point to reshape. Click empty space to deselect.</span>}
          </div>
        </div>

        <div className="setup-roi-zone-pane">
          <div className="setup-roi-zone-head">
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
              Zones <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>· {zones.length}</span>
            </h4>
            <button className="tb-btn" onClick={() => { setMode('draw'); setDraft({ points: [], hoverPos: null, snapFirst: false }); setSelectedId(null); }}>
              <span className="mi">add</span>Add Zone
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {pendingZone && <NewZoneDialog onConfirm={addZone} onCancel={() => setPendingZone(null)} />}
            {zones.length === 0 && !pendingZone && (
              <div className="setup-empty" style={{ padding: '28px 16px' }}>
                <span className="mi">layers_clear</span>
                No zones yet — click <strong>Add Zone</strong> and draw on the canvas.
              </div>
            )}
            {zones.map(z => (
              <ZoneCard key={z.id} zone={z} selected={z.id === selectedId}
                collapsed={collapsed.has(z.id)}
                onToggleCollapse={() => setCollapsed(s => { const n = new Set(s); n.has(z.id) ? n.delete(z.id) : n.add(z.id); return n; })}
                onSelect={() => { setSelectedId(z.id); setMode('select'); }}
                onChange={patch => updateZone(z.id, patch)}
                onDelete={() => deleteZone(z.id)}
                onTogglePerspective={() => togglePerspective(z)}
                onPreview={() => setPreviewZone(z)} />
            ))}
          </div>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
      {previewZone && (
        <ZonePreviewModal
          zone={previewZone}
          snapshotUrl={snapshotUrl}
          onClose={() => setPreviewZone(null)}
        />
      )}
    </div>
  );
}

// ─── NewZoneDialog ────────────────────────────────────────────────────────────
function NewZoneDialog({ onConfirm, onCancel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('include');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="setup-inline-dialog">
      <h5>Name this zone</h5>
      <input ref={ref} className="setup-form-input" value={name} placeholder="e.g. cabinet, entrance"
        style={{ marginBottom: 10 }}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && name) onConfirm(name, type); }} />
      <div className="setup-mode-toggle" style={{ marginBottom: 10 }}>
        <div className={`setup-mode-btn ${type === 'include' ? 'on' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setType('include')}>
          <span className="mi">check_circle</span>include
        </div>
        <div className={`setup-mode-btn ${type === 'exclude' ? 'on' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setType('exclude')}>
          <span className="mi">block</span>exclude
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="tb-btn" onClick={onCancel}>Cancel</button>
        <button className="tb-btn primary" disabled={!name} onClick={() => onConfirm(name, type)}>Add zone</button>
      </div>
    </div>
  );
}

// ─── ZonePreviewModal ─────────────────────────────────────────────────────────
function ZonePreviewModal({ zone, snapshotUrl, onClose }) {
  const isExclude = zone.type === 'exclude';
  const pointsStr = zone.points.map(p => `${p.x},${p.y}`).join(' ');
  const c = zone.points.reduce((a, p) => ({ x: a.x + p.x / zone.points.length, y: a.y + p.y / zone.points.length }), { x: 0, y: 0 });

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '85vh', background: '#111', borderRadius: 10, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)' }}>
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
            <span className="mi" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 5, color: isExclude ? '#ff6b6b' : '#4caf91' }}>
              {isExclude ? 'block' : 'check_circle'}
            </span>
            {zone.name}
            <span style={{ fontWeight: 400, opacity: 0.65, marginLeft: 6 }}>— {zone.type} zone · {zone.points.length} pts</span>
          </div>
          <button onClick={onClose} style={{ appearance: 'none', border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 3 }}>
            <span className="mi" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>
        {snapshotUrl ? (
          <div style={{ position: 'relative', display: 'flex' }}>
            <img src={snapshotUrl} style={{ display: 'block', maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain' }} alt="" />
            {/* SVG uses same 1920×1080 viewBox + xMidYMid meet → aligns perfectly with objectFit:contain */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet">
              <polygon
                points={pointsStr}
                fill={isExclude ? 'rgba(255,80,80,0.28)' : 'rgba(40,200,130,0.28)'}
                stroke={isExclude ? 'rgba(255,80,80,0.9)' : 'rgba(40,200,130,0.9)'}
                strokeWidth="3" vectorEffect="non-scaling-stroke"
              />
              <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle"
                fontSize="36" fontWeight="700" fill="#fff"
                stroke="rgba(0,0,0,0.75)" strokeWidth="8" paintOrder="stroke">
                {zone.name}
              </text>
            </svg>
          </div>
        ) : (
          <div style={{ padding: '60px 80px', color: 'var(--ink-3)', textAlign: 'center' }}>
            <span className="mi" style={{ fontSize: 40, display: 'block', marginBottom: 12, color: 'var(--ink-4)' }}>image_not_supported</span>
            <div style={{ fontSize: 13 }}>No snapshot loaded — click <strong>Get snapshot</strong> in the canvas toolbar first.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ZoneCard ─────────────────────────────────────────────────────────────────
function ZoneCard({ zone, selected, collapsed, onToggleCollapse, onSelect, onChange, onDelete, onTogglePerspective, onPreview }) {
  const [editingName, setEditingName] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const isExclude = zone.type === 'exclude';
  return (
    <div style={{ border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`, borderRadius: 6, marginBottom: 6, overflow: 'hidden', cursor: 'pointer', transition: 'border-color .12s' }}
      onClick={onSelect}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: selected ? 'var(--accent-soft)' : 'var(--bg-2)' }}>
        <span className="mi" style={{ fontSize: 16, cursor: 'pointer', color: 'var(--ink-3)' }}
          onClick={e => { e.stopPropagation(); onToggleCollapse(); }}>
          {collapsed ? 'chevron_right' : 'expand_more'}
        </span>
        {editingName ? (
          <input style={{ flex: 1, fontWeight: 600, fontSize: 13, border: 'none', background: 'transparent', color: 'var(--ink)', padding: 0 }}
            autoFocus value={zone.name}
            onChange={e => onChange({ name: e.target.value })}
            onBlur={() => setEditingName(false)}
            onKeyDown={e => { if (e.key === 'Enter') setEditingName(false); }}
            onClick={e => e.stopPropagation()} />
        ) : (
          <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}
            onDoubleClick={e => { e.stopPropagation(); setEditingName(true); }}
            title="Double-click to rename">
            {zone.name}
          </span>
        )}
        <span style={{
          padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
          background: isExclude ? 'var(--sev-alarm-bg)' : 'var(--accent-soft)',
          color: isExclude ? 'var(--sev-alarm)' : 'var(--accent-ink)',
          border: `1px solid ${isExclude ? 'var(--sev-alarm)' : 'var(--accent)'}`,
        }} onClick={e => { e.stopPropagation(); onChange({ type: zone.type === 'include' ? 'exclude' : 'include' }); }}>
          {zone.type}
        </span>
      </div>
      {!collapsed && (
        <div style={{ padding: '10px', background: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: 'var(--ink-3)' }}>Rotation</span>
            <span style={{ fontFamily: 'monospace' }}>{zone.rotation > 0 ? '+' : ''}{zone.rotation}°</span>
          </div>
          <input type="range" className="slider" min="-45" max="45" step="1"
            value={zone.rotation} onChange={e => onChange({ rotation: parseInt(e.target.value, 10) })}
            style={{ width: '100%', marginBottom: 8 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, marginBottom: 8 }}
            onClick={onTogglePerspective}>
            <div style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--line-2)', background: zone.perspective ? 'var(--accent)' : 'transparent', display: 'grid', placeItems: 'center' }}>
              {zone.perspective && <span className="mi" style={{ fontSize: 10, color: '#fff' }}>check</span>}
            </div>
            <span>Perspective quad rectification</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>{zone.points.length} points defined</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="tb-btn" onClick={() => onPreview()}>
              <span className="mi">preview</span>Preview
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              {confirmDel ? (
                <Fragment>
                  <button className="tb-btn" onClick={() => setConfirmDel(false)}>Cancel</button>
                  <button className="tb-btn" style={{ color: 'var(--sev-alarm)', borderColor: 'var(--sev-alarm)' }} onClick={onDelete}>
                    <span className="mi">delete</span>Confirm
                  </button>
                </Fragment>
              ) : (
                <button className="tb-btn" style={{ color: 'var(--sev-alarm)' }} onClick={() => setConfirmDel(true)}>
                  <span className="mi">delete</span>Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SignalList ───────────────────────────────────────────────────────────────
function SignalList({ signals, onBack, onNew, onEdit, onDelete }) {
  const [search, setSearch] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return signals;
    return signals.filter(s =>
      s.id.toLowerCase().includes(q) ||
      (s.name || '').toLowerCase().includes(q) ||
      s.text.toLowerCase().includes(q)
    );
  }, [search, signals]);

  return (
    <div className="setup-page">
      <div className="setup-breadcrumb">
        <button onClick={onBack}>Setup</button><span className="sep">/</span>
        <span className="current">Signals</span>
      </div>
      <div className="setup-page-head">
        <div>
          <h1 className="setup-page-title">Signal Library</h1>
          <p className="setup-page-sub">{signals.length} signal{signals.length === 1 ? '' : 's'} · semantic descriptions used by the embedder.</p>
        </div>
        <button className="tb-btn primary" onClick={onNew}><span className="mi">add</span>New Signal</button>
      </div>
      <div className="setup-search-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span className="mi" style={{ color: 'var(--ink-4)', fontSize: 18 }}>search</span>
        <input className="setup-form-input" placeholder="Search by id, name or phrase…"
          value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
      </div>
      {filtered.length === 0 ? (
        <div className="setup-empty">
          <span className="mi">{search ? 'search_off' : 'graph_3'}</span>
          {search ? `No signals match "${search}"` : 'No signals defined yet.'}
        </div>
      ) : (
        <div className="setup-sig-list">
          {filtered.map(s => {
            const color = s.default_action === 'alarm' ? 'var(--sev-alarm)' : s.default_action === 'notify' ? 'var(--sev-notify)' : 'var(--sev-stat)';
            const bg = s.default_action === 'alarm' ? 'var(--sev-alarm-bg)' : s.default_action === 'notify' ? 'var(--sev-notify-bg)' : 'var(--sev-stat-bg)';
            return (
              <div key={s.id} className="setup-sig-card">
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: color }} />
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-2)' }}>{s.id}</span>
                    <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'var(--bg-2)', color: 'var(--ink-3)', border: '1px solid var(--line)' }}>P{s.priority}</span>
                    <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: bg, color }}>{s.default_action}</span>
                    {s.name && s.name !== s.id && <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{s.name}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink-2)', fontStyle: 'italic', marginBottom: 6, lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    "{s.text}"
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
                    <span>thr {s.default_threshold.toFixed(2)}</span>
                    {s.zone?.length > 0 && <><span style={{ opacity: 0.4 }}>·</span><span>zones: {s.zone.join(', ')}</span></>}
                    {s.escalation_llm && <><span style={{ opacity: 0.4 }}>·</span><span style={{ color: 'var(--ok)' }}>LLM ✓</span></>}
                    {s.webhook && (s.webhook.notify || s.webhook.alarm_primary) && (
                      <><span style={{ opacity: 0.4 }}>·</span><span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span className="mi" style={{ fontSize: 11 }}>webhook</span>webhook</span></>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                  <button className="tb-btn" onClick={() => onEdit(s)}><span className="mi">edit</span>Edit</button>
                  {confirmDel === s.id ? (
                    <Fragment>
                      <button className="tb-btn" onClick={() => setConfirmDel(null)}>Cancel</button>
                      <button className="tb-btn" style={{ color: 'var(--sev-alarm)', borderColor: 'var(--sev-alarm)' }}
                        onClick={() => { onDelete(s.id); setConfirmDel(null); }}>
                        <span className="mi">delete</span>Confirm
                      </button>
                    </Fragment>
                  ) : (
                    <button className="tb-btn" style={{ color: 'var(--sev-alarm)' }} onClick={() => setConfirmDel(s.id)}>
                      <span className="mi">delete</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Stepper ──────────────────────────────────────────────────────────────────
const STEPS = [{ n: 1, label: 'Describe' }, { n: 2, label: 'Examples' }, { n: 3, label: 'Calibrate' }, { n: 4, label: 'Review' }];

function Stepper({ current }) {
  return (
    <div className="setup-stepper">
      {STEPS.map((s, i) => {
        const done = s.n < current, active = s.n === current;
        return (
          <Fragment key={s.n}>
            <div className="setup-step">
              <div className={`setup-step-dot ${done ? 'done' : active ? 'active' : ''}`}>
                {done ? <span className="mi">check</span> : s.n}
              </div>
              <div className={`setup-step-label ${done ? 'done' : active ? 'active' : ''}`}>{s.label}</div>
            </div>
            {i < STEPS.length - 1 && <div className={`setup-step-line ${done ? 'done' : ''}`} />}
          </Fragment>
        );
      })}
    </div>
  );
}

// ─── Step 1 — Describe ────────────────────────────────────────────────────────
function Step1({ state, onChange, cameras, zonesByCam }) {
  const [loading, setLoading] = useState(false);
  const [editingPhrase, setEditingPhrase] = useState(false);
  const debounceRef = useRef(null);
  const cam = cameras.find(c => c.id === state.camera_id);
  const availableZones = (zonesByCam[cam?.id] || []).filter(z => z.type === 'include');

  useEffect(() => {
    if (!state.description || state.description.length < 12 || state.phrase) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSuggest(false), 900);
    return () => clearTimeout(debounceRef.current);
  }, [state.description]);

  const doSuggest = async (regenerate) => {
    if (!state.description || state.description.length < 12) return;
    setLoading(true);
    try {
      const res = await setupApi.suggestPhrase({
        description: state.description + (regenerate ? ' (please provide a different phrasing)' : ''),
        zones: state.zones,
        area_type: 'indoor_public',
      });
      onChange({ phrase: res.phrase });
    } catch {
      onChange({ phrase: state.description.slice(0, 200) });
    }
    setLoading(false);
  };

  const toggleZone = name => onChange({
    zones: state.zones.includes(name) ? state.zones.filter(z => z !== name) : [...state.zones, name],
  });

  return (
    <div className="setup-wizard-card">
      <h2>Describe the event</h2>
      <p className="sub">Tell us in plain language what the camera should detect. The AI will translate it into an embedding-friendly phrase you can refine.</p>

      <div className="setup-form-row">
        <label className="setup-form-label">Camera context</label>
        <select className="setup-form-select" value={state.camera_id || ''} onChange={e => onChange({ camera_id: e.target.value, zones: [] })}>
          <option value="">— Select camera —</option>
          {cameras.map(c => <option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}
        </select>
      </div>

      <div className="setup-form-row">
        <label className="setup-form-label">What should this camera detect?</label>
        <textarea className="setup-form-textarea"
          placeholder="e.g. A person accessing the honour bar cabinet, reaching inside to take a product"
          value={state.description}
          onChange={e => onChange({ description: e.target.value })} />
      </div>

      <div className="setup-form-row split">
        <div>
          <label className="setup-form-label">Priority</label>
          <div className="setup-pri-pills">
            {[1, 2, 3, 4, 5].map(p => (
              <div key={p} className={`setup-pri-pill p${p} ${state.priority === p ? 'on' : ''}`}
                onClick={() => onChange({ priority: p })}>{p}</div>
            ))}
          </div>
          <span className="setup-form-hint">P1 critical · P5 informational</span>
        </div>
        <div>
          <label className="setup-form-label">Action</label>
          <select className="setup-form-select" value={state.action} onChange={e => onChange({ action: e.target.value })}>
            <option value="statistic">statistic — log only</option>
            <option value="notify">notify — queue for review</option>
            <option value="alarm">alarm — immediate escalation</option>
          </select>
        </div>
      </div>

      {availableZones.length > 0 && (
        <div className="setup-form-row">
          <label className="setup-form-label">Apply to zones</label>
          <div className="setup-zone-chips">
            {availableZones.map(z => (
              <div key={z.id} className={`setup-zone-chip ${state.zones.includes(z.name) ? 'on' : ''}`}
                onClick={() => toggleZone(z.name)}>
                {state.zones.includes(z.name) && <span className="mi" style={{ fontSize: 12 }}>check</span>}
                {z.name}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="setup-ai-card">
        <div className="setup-ai-card-hd"><span className="mi">auto_awesome</span>AI · Suggested semantic phrase</div>
        {loading ? (
          <div className="setup-ai-card-phrase empty">Generating phrase optimized for the embedder…</div>
        ) : state.phrase ? (
          editingPhrase ? (
            <textarea className="setup-form-textarea" autoFocus value={state.phrase}
              onChange={e => onChange({ phrase: e.target.value })}
              onBlur={() => setEditingPhrase(false)}
              style={{ minHeight: 60, marginBottom: 0 }} />
          ) : (
            <div className="setup-ai-card-phrase">"{state.phrase}"</div>
          )
        ) : (
          <div className="setup-ai-card-phrase empty">Start typing a description above — the suggested phrase will appear here.</div>
        )}
        {state.phrase && !loading && (
          <div className="setup-ai-card-foot">
            <button className="tb-btn" onClick={() => setEditingPhrase(e => !e)}>
              <span className="mi">edit</span>{editingPhrase ? 'Done editing' : 'Edit phrase'}
            </button>
            <button className="tb-btn" onClick={() => doSuggest(true)} disabled={loading}>
              <span className="mi">refresh</span>Regenerate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 2 — Examples ────────────────────────────────────────────────────────
function ClipColumn({ kind, clips, onAdd, onRemove, cameras, defaultCam }) {
  const isPos = kind === 'positive';
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureErr, setCaptureErr] = useState(null);
  const [capture, setCapture] = useState({
    camera: defaultCam || cameras[0]?.id || '',
    date: new Date().toISOString().slice(0, 10),
    from: isPos ? '17:30' : '10:00',
    to: isPos ? '17:35' : '10:05',
  });
  const fileRef = useRef(null);

  const handleFiles = async files => {
    setUploading(true);
    for (const f of Array.from(files)) {
      try {
        const res = await setupApi.uploadClip(kind, f);
        onAdd({ clip_id: res.clip_id, name: res.filename || f.name, size_bytes: res.size_bytes, duration_sec: res.duration_sec });
      } catch (err) {
        console.error('Upload failed:', err.message);
      }
    }
    setUploading(false);
  };

  const doCapture = async () => {
    setCapturing(true);
    setCaptureErr(null);
    try {
      const res = await setupApi.captureClip({ camera_id: capture.camera, date: capture.date, time_from: capture.from, time_to: capture.to, label: kind });
      onAdd({ clip_id: res.clip_id, name: res.filename, size_bytes: res.size_bytes, duration_sec: res.duration_sec });
    } catch (err) {
      setCaptureErr(err.message);
    }
    setCapturing(false);
  };

  const fmtSize = bytes => bytes ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : '';

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <div className="setup-step2-col-title">
          {isPos ? 'Positive examples' : 'Negative examples'}
          <span className={`badge ${isPos ? 'pos' : 'neg'}`}>{clips.length} clip{clips.length === 1 ? '' : 's'}</span>
        </div>
        <p className="setup-step2-col-sub">
          {isPos ? 'What SHOULD trigger this signal — clear, varied examples.' : 'What should NOT trigger — similar situations that must be ignored.'}
        </p>
      </div>

      <div className={`setup-dropzone ${drag ? 'drag-over' : ''}`}
        onClick={() => !uploading && fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}>
        <span className="mi">cloud_upload</span>
        <div className="setup-dropzone-text">{uploading ? 'Uploading…' : 'Drop video files here or click to upload'}</div>
        <div className="setup-dropzone-hint">.mp4 .mov .avi · max 500 MB / clip</div>
        <input ref={fileRef} type="file" accept="video/*" multiple style={{ display: 'none' }}
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 8px', color: 'var(--ink-4)', fontSize: 11 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        <span>OR CAPTURE FROM CAMERA</span>
        <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>

      <div className="setup-capture-block">
        <div className="setup-capture-hd">Axis recording extract</div>
        <select className="setup-form-select" style={{ height: 30, fontSize: 12, marginBottom: 8 }}
          value={capture.camera} onChange={e => setCapture(s => ({ ...s, camera: e.target.value }))}>
          {cameras.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
        </select>
        <div className="setup-capture-fields">
          <input type="date" className="setup-form-input" value={capture.date} onChange={e => setCapture(s => ({ ...s, date: e.target.value }))} />
          <input type="time" className="setup-form-input" style={{ width: 90 }} value={capture.from} onChange={e => setCapture(s => ({ ...s, from: e.target.value }))} />
          <input type="time" className="setup-form-input" style={{ width: 90 }} value={capture.to} onChange={e => setCapture(s => ({ ...s, to: e.target.value }))} />
        </div>
        {captureErr && <div style={{ color: 'var(--sev-alarm)', fontSize: 12, marginTop: 6 }}>{captureErr}</div>}
        <button className="tb-btn" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
          onClick={doCapture} disabled={capturing}>
          <span className="mi">add</span>{capturing ? 'Capturing…' : 'Capture clip'}
        </button>
      </div>

      {clips.length > 0 && (
        <div className="setup-clip-list">
          {clips.map(c => (
            <div key={c.clip_id} className="setup-clip-row">
              <span className="mi thumb">video_file</span>
              <span className="cname">{c.name}</span>
              <span className="cmeta">{c.duration_sec ? `${c.duration_sec}s` : fmtSize(c.size_bytes)}</span>
              <span className="mi ccheck">check_circle</span>
              <span className="mi crm" onClick={() => onRemove(c.clip_id)} title="Remove">close</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Step2({ state, onChange, cameras }) {
  const addPos = c => onChange(s => ({ ...s, positiveClips: [...s.positiveClips, c] }));
  const rmPos = id => onChange(s => ({ ...s, positiveClips: s.positiveClips.filter(c => c.clip_id !== id) }));
  const addNeg = c => onChange(s => ({ ...s, negativeClips: [...s.negativeClips, c] }));
  const rmNeg = id => onChange(s => ({ ...s, negativeClips: s.negativeClips.filter(c => c.clip_id !== id) }));

  return (
    <div className="setup-wizard-card setup-wizard-card-wide">
      <h2>Upload examples</h2>
      <p className="sub">Provide reference clips so the embedder can be calibrated against this signal. Drop video files, or extract clips from an Axis camera by time range.</p>
      <div className="setup-step2-split">
        <ClipColumn kind="positive" clips={state.positiveClips} onAdd={addPos} onRemove={rmPos} cameras={cameras} defaultCam={state.camera_id} />
        <ClipColumn kind="negative" clips={state.negativeClips} onAdd={addNeg} onRemove={rmNeg} cameras={cameras} defaultCam={state.camera_id} />
      </div>
      {state.negativeClips.length > 0 && state.negativeClips.length < 3 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '10px 12px', borderRadius: 6, background: 'var(--sev-notify-bg)', border: '1px solid var(--sev-notify)', color: 'var(--sev-notify)', fontSize: 13 }}>
          <span className="mi">warning</span>
          We recommend at least <strong>3 negative examples</strong> for accurate calibration. You currently have {state.negativeClips.length}.
        </div>
      )}
    </div>
  );
}

// ─── Step 3 — Calibrate ───────────────────────────────────────────────────────
function ScoreRow({ name, score, threshold, isPositive }) {
  const fillPct = Math.round((score || 0) * 100);
  const thrPct = threshold * 100;
  const passing = (score || 0) >= threshold;
  const correct = isPositive ? passing : !passing;
  return (
    <div className="setup-score-row">
      <div className="setup-score-name" title={name}>{name}</div>
      <div className="setup-score-bar-wrap">
        <div className={`setup-score-bar-fill ${isPositive ? 'pos' : 'neg'}`} style={{ width: fillPct + '%' }} />
        <div className="setup-score-bar-thr" style={{ left: thrPct + '%' }} />
      </div>
      <div className="setup-score-val">{(score || 0).toFixed(2)}</div>
      <div className={`setup-score-status ${correct ? 'good' : isPositive ? 'bad' : 'warn'}`}>
        <span className="mi">{correct ? 'check' : isPositive ? 'close' : 'warning'}</span>
      </div>
    </div>
  );
}

function Step3({ state, onChange }) {
  const [phase, setPhase] = useState('idle');
  const [scores, setScores] = useState({});
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [error, setError] = useState(null);
  const [editingPhrase, setEditingPhrase] = useState(false);

  const runCalibration = useCallback(async () => {
    const total = state.positiveClips.length + state.negativeClips.length;
    if (total === 0) return;
    setPhase('running');
    setScores({});
    setAiSuggestion(null);
    setError(null);
    setProgress({ current: 0, total });
    try {
      await setupApi.calibrateSSE({
        phrase: state.phrase,
        positive_clips: state.positiveClips.map(c => c.clip_id),
        negative_clips: state.negativeClips.map(c => c.clip_id),
        threshold: state.threshold,
        llm_recommendation: true,
      }, evt => {
        if (evt.type === 'progress') setProgress({ current: evt.current, total: evt.total });
        if (evt.type === 'score') setScores(s => ({ ...s, [evt.clip_id]: evt.score }));
        if (evt.type === 'recommendation') setAiSuggestion(evt);
        if (evt.type === 'done') setPhase('done');
        if (evt.type === 'error') { setError(evt.detail); }
      });
    } catch (err) {
      setError(err.message);
      setPhase('done');
    }
  }, [state.phrase, state.positiveClips, state.negativeClips]);

  useEffect(() => { runCalibration(); }, []);

  const posClips = state.positiveClips.map(c => ({ ...c, score: scores[c.clip_id] }));
  const negClips = state.negativeClips.map(c => ({ ...c, score: scores[c.clip_id] }));
  const posPass = posClips.filter(c => c.score != null && c.score >= state.threshold).length;
  const negFalse = negClips.filter(c => c.score != null && c.score >= state.threshold).length;
  const total = posClips.length + negClips.length;
  const pct = total ? Math.round((progress.current / total) * 100) : 0;

  return (
    <div className="setup-wizard-card setup-wizard-card-wide">
      <h2>Calibrate threshold</h2>
      <p className="sub">The embedder scores each clip against the semantic phrase. Adjust the threshold to balance detection rate and false positives.</p>

      {phase === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 12px', borderRadius: 6, background: 'var(--accent-soft)', border: '1px solid var(--accent)' }}>
          <span className="mi" style={{ color: 'var(--accent)' }}>autorenew</span>
          <div style={{ flex: 1, height: 6, background: 'var(--bg-2)', borderRadius: 3, border: '1px solid var(--line)' }}>
            <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${pct}%`, transition: 'width .3s' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--accent-ink)', fontFamily: 'monospace' }}>{progress.current}/{total}</span>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--sev-alarm)', fontSize: 13, marginBottom: 12, padding: '8px 10px', background: 'var(--sev-alarm-bg)', borderRadius: 6 }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div className="setup-form-label" style={{ marginBottom: 6 }}>Semantic phrase being tested</div>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {editingPhrase ? (
            <textarea className="setup-form-textarea" autoFocus value={state.phrase}
              onChange={e => onChange({ phrase: e.target.value })}
              onBlur={() => setEditingPhrase(false)}
              style={{ flex: 1, minHeight: 56, marginBottom: 0, fontStyle: 'italic' }} />
          ) : (
            <div style={{ flex: 1, fontStyle: 'italic', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>"{state.phrase}"</div>
          )}
          {!editingPhrase && (
            <button className="tb-btn" onClick={() => setEditingPhrase(true)}><span className="mi">edit</span>Edit</button>
          )}
        </div>
        {editingPhrase && (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="tb-btn primary" onClick={() => { setEditingPhrase(false); runCalibration(); }}>
              <span className="mi">refresh</span>Re-run with new phrase
            </button>
          </div>
        )}
      </div>

      <div className="setup-calib-cols">
        <div className="setup-calib-col">
          <h5 className="pos">Positive clips <span style={{ fontWeight: 400, fontSize: 10, textTransform: 'none', color: 'var(--ink-3)' }}>{posPass}/{posClips.length} detected</span></h5>
          {posClips.length === 0 && <div className="setup-form-hint">No positive clips uploaded.</div>}
          {posClips.map(c => <ScoreRow key={c.clip_id} name={c.name} score={c.score ?? 0} threshold={state.threshold} isPositive={true} />)}
        </div>
        <div className="setup-calib-col">
          <h5 style={{ color: 'var(--sev-alarm)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '.08em', fontWeight: 600 }}>
            Negative clips <span style={{ fontWeight: 400, fontSize: 10, textTransform: 'none', color: 'var(--ink-3)' }}>{negClips.length - negFalse}/{negClips.length} correctly ignored</span>
          </h5>
          {negClips.length === 0 && <div className="setup-form-hint">No negative clips uploaded.</div>}
          {negClips.map(c => <ScoreRow key={c.clip_id} name={c.name} score={c.score ?? 0} threshold={state.threshold} isPositive={false} />)}
        </div>
      </div>

      <div className="setup-thr-wrap">
        <div className="setup-thr-head">
          <span className="lbl">Detection threshold</span>
          <span className="val">{state.threshold.toFixed(2)}</span>
        </div>
        <input type="range" className="slider" min="0.10" max="0.90" step="0.01"
          value={state.threshold} onChange={e => onChange({ threshold: parseFloat(e.target.value) })}
          style={{ width: '100%' }} />
        <div className="setup-thr-hint">
          <span>← lower (more sensitive)</span><span>higher (more strict) →</span>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: posPass === posClips.length && posClips.length > 0 ? 'var(--ok)' : 'var(--sev-alarm)' }}>
            <span className="mi">{posPass === posClips.length && posClips.length > 0 ? 'check_circle' : 'cancel'}</span>
            <span><strong>{posPass}/{posClips.length}</strong> positive detected</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: negFalse === 0 ? 'var(--ok)' : 'var(--sev-notify)' }}>
            <span className="mi">{negFalse === 0 ? 'check_circle' : 'warning'}</span>
            <span><strong>{negFalse}/{negClips.length}</strong> false positive{negFalse === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {aiSuggestion && (
        <div className="setup-ai-card" style={{ marginTop: 18 }}>
          <div className="setup-ai-card-hd"><span className="mi">auto_awesome</span>AI Recommendation</div>
          <div className="setup-ai-card-phrase" style={{ fontStyle: 'normal' }}>{aiSuggestion.reasoning}</div>
          <div className="setup-ai-card-foot">
            {aiSuggestion.suggested_threshold && (
              <button className="tb-btn" onClick={() => onChange({ threshold: aiSuggestion.suggested_threshold })}>
                <span className="mi">tune</span>Raise threshold to {aiSuggestion.suggested_threshold.toFixed(2)}
              </button>
            )}
            {aiSuggestion.suggested_phrase && aiSuggestion.suggested_phrase !== state.phrase && (
              <button className="tb-btn" onClick={() => { onChange({ phrase: aiSuggestion.suggested_phrase }); runCalibration(); }}>
                <span className="mi">edit</span>Use refined phrase
              </button>
            )}
            <button className="tb-btn" onClick={() => setEditingPhrase(true)}>
              <span className="mi">edit</span>Edit phrase manually
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <button className="tb-btn" onClick={runCalibration}><span className="mi">refresh</span>Re-run calibration</button>
        </div>
      )}
    </div>
  );
}

// ─── WebhookSection ───────────────────────────────────────────────────────────
function WebhookUrlInput({ value, onChange, placeholder }) {
  return (
    <input
      className="setup-form-input mono"
      placeholder={placeholder || 'https://hooks.example.com/signal'}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ flex: 1, fontSize: 12 }}
    />
  );
}

function RetryPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>retries</span>
      {[1, 2, 3, 5].map(n => (
        <button key={n} onClick={() => onChange(n)} style={{
          width: 26, height: 26, border: `1px solid ${value === n ? 'var(--accent)' : 'var(--line-2)'}`,
          borderRadius: 4, background: value === n ? 'var(--accent)' : 'transparent',
          color: value === n ? '#fff' : 'var(--ink-3)',
          cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0,
        }}>{n}</button>
      ))}
    </div>
  );
}

function WebhookSection({ action, state, onChange }) {
  if (action === 'statistic') {
    return (
      <div style={{ borderTop: '1px solid var(--line)', padding: '12px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Webhooks</div>
        <div style={{ fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>Not applicable for statistic-level signals.</div>
      </div>
    );
  }

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 };
  const labelStyle = { width: 100, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0 };
  const badgeStyle = (color) => ({
    padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700,
    background: color + '1a', color, border: `1px solid ${color}`,
    textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0,
  });

  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '14px 16px 10px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mi" style={{ fontSize: 14, color: 'var(--ink-4)' }}>webhook</span>
        Webhooks
      </div>

      {action === 'notify' && (
        <div style={rowStyle}>
          <span style={badgeStyle('var(--sev-notify)')}>notify</span>
          <div style={labelStyle}>URL</div>
          <WebhookUrlInput value={state.webhookNotifyUrl} onChange={v => onChange({ webhookNotifyUrl: v })} />
        </div>
      )}

      {action === 'alarm' && (
        <>
          <div style={{ marginBottom: 10 }}>
            <div style={rowStyle}>
              <span style={badgeStyle('var(--sev-alarm)')}>primary</span>
              <div style={labelStyle}>URL</div>
              <WebhookUrlInput value={state.webhookAlarmPrimaryUrl} onChange={v => onChange({ webhookAlarmPrimaryUrl: v })} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <RetryPicker value={state.webhookAlarmPrimaryRetries} onChange={v => onChange({ webhookAlarmPrimaryRetries: v })} />
            </div>
          </div>
          <div style={{ padding: '10px 0 0', borderTop: '1px dashed var(--line)' }}>
            <div style={{ ...rowStyle, marginBottom: 4 }}>
              <span style={badgeStyle('var(--ink-3)')}>fallback</span>
              <div style={labelStyle}>URL <span style={{ fontWeight: 400, color: 'var(--ink-4)' }}>· optional</span></div>
              <WebhookUrlInput
                value={state.webhookAlarmFallbackUrl}
                onChange={v => onChange({ webhookAlarmFallbackUrl: v })}
                placeholder="https://backup-hook.example.com/alarm"
              />
            </div>
            {state.webhookAlarmFallbackUrl && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <RetryPicker value={state.webhookAlarmFallbackRetries} onChange={v => onChange({ webhookAlarmFallbackRetries: v })} />
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
              Called if the primary webhook fails all retries.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 4 — Review ─────────────────────────────────────────────────────────
function Step4({ state, onChange, existingSignalIds, prompts = [] }) {
  const [editing, setEditing] = useState(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [finalEvalText, setFinalEvalText] = useState('');
  const [finalEvalOrig, setFinalEvalOrig] = useState('');
  const [finalEvalLoading, setFinalEvalLoading] = useState(false);
  const [finalEvalSaving, setFinalEvalSaving] = useState(false);
  const [finalEvalMsg, setFinalEvalMsg] = useState(null);
  const exists = existingSignalIds.includes(state.signalId) && !state.editingExisting;
  const actionColor = state.action === 'alarm' ? 'var(--sev-alarm)' : state.action === 'notify' ? 'var(--sev-notify)' : 'var(--sev-stat)';
  const actionBg = state.action === 'alarm' ? 'var(--sev-alarm-bg)' : state.action === 'notify' ? 'var(--sev-notify-bg)' : 'var(--sev-stat-bg)';
  const selectedPrompt = prompts.find(p => p.key === state.llmPromptKey);

  useEffect(() => {
    if (!state.llmCheck || !state.llmPromptKey) { setFinalEvalText(''); setFinalEvalOrig(''); return; }
    setFinalEvalLoading(true);
    setFinalEvalMsg(null);
    setupApi.getPromptDetail(state.llmPromptKey)
      .then(d => { const t = d.final_eval || ''; setFinalEvalText(t); setFinalEvalOrig(t); })
      .catch(() => { setFinalEvalText(''); setFinalEvalOrig(''); })
      .finally(() => setFinalEvalLoading(false));
  }, [state.llmPromptKey, state.llmCheck]);

  const saveFinalEval = async () => {
    setFinalEvalSaving(true);
    setFinalEvalMsg(null);
    try {
      await setupApi.patchPrompt(state.llmPromptKey, { final_eval: finalEvalText || null });
      setFinalEvalOrig(finalEvalText);
      setFinalEvalMsg({ ok: true, text: 'Saved' });
    } catch (e) {
      setFinalEvalMsg({ ok: false, text: e.message });
    } finally {
      setFinalEvalSaving(false);
    }
  };

  return (
    <div className="setup-wizard-card">
      <h2>Signal ready to save</h2>
      <p className="sub">Review the configuration before adding it to the library. You can edit any field inline.</p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        {[
          { label: 'Signal ID', key: 'signalId', mono: true, editable: !state.editingExisting },
          { label: 'Name', key: 'name', editable: true },
        ].map(row => (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0 }}>{row.label}</div>
            {editing === row.key && row.editable ? (
              <input className={`setup-form-input ${row.mono ? 'mono' : ''}`} autoFocus style={{ flex: 1 }}
                value={state[row.key]}
                onChange={e => { const v = row.mono ? e.target.value.toLowerCase() : e.target.value; if (!row.mono || ID_RE.test(v)) onChange({ [row.key]: v }); }}
                onBlur={() => setEditing(null)}
                onKeyDown={e => { if (e.key === 'Enter') setEditing(null); }} />
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: row.mono ? 'monospace' : undefined, fontSize: 13, color: 'var(--ink)' }}>{state[row.key] || '— not set —'}</span>
                {row.editable && (
                  <button style={{ padding: '1px 6px', fontSize: 11, background: 'none', border: '1px solid var(--line-2)', borderRadius: 4, cursor: 'pointer', color: 'var(--ink-3)' }}
                    onClick={() => setEditing(row.key)}>edit</button>
                )}
              </div>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0, paddingTop: 2 }}>Phrase</div>
          <div style={{ flex: 1, fontSize: 13, fontStyle: 'italic', color: 'var(--ink-2)', lineHeight: 1.5 }}>"{state.phrase}"</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0 }}>Priority · Action</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'var(--bg-2)', color: 'var(--ink-3)', border: '1px solid var(--line)' }}>P{state.priority}</span>
            <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: actionBg, color: actionColor }}>{state.action}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0 }}>Threshold</div>
          <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{state.threshold.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0 }}>Zones</div>
          <span style={{ fontSize: 13 }}>{state.zones.length ? state.zones.join(', ') : '— any —'}</span>
        </div>
        {/* LLM check row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderBottom: state.llmCheck ? 'none' : '1px solid var(--line)' }}>
          <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0 }}>LLM check</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className={`setup-sw ${state.llmCheck ? 'on' : ''}`} onClick={() => onChange({ llmCheck: !state.llmCheck, llmPromptKey: !state.llmCheck ? state.llmPromptKey : '' })} />
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {state.llmCheck ? 'Vision LLM will confirm matches above threshold' : 'Recommended for notify and alarm signals'}
            </span>
          </div>
        </div>

        {/* LLM prompt selector — only when llmCheck is on */}
        {state.llmCheck && (
          <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '12px 16px' }}>
              <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0, paddingTop: 2 }}>
                LLM prompt
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Current selection summary */}
                <div
                  onClick={() => setPromptOpen(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    background: 'var(--surface)', border: `1px solid ${promptOpen ? 'var(--accent)' : 'var(--line-2)'}`,
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    transition: 'border-color .12s',
                  }}
                >
                  {state.llmPromptKey ? (
                    <>
                      <span className="mi" style={{ fontSize: 16, color: 'var(--accent)', flexShrink: 0 }}>smart_toy</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>
                          {state.llmPromptKey}
                        </div>
                        {selectedPrompt && (
                          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {selectedPrompt.preview}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="mi" style={{ fontSize: 16, color: 'var(--ink-4)', flexShrink: 0 }}>auto_awesome</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
                          generic fallback — no specific prompt selected
                        </div>
                      </div>
                    </>
                  )}
                  <span className="mi" style={{ fontSize: 16, color: 'var(--ink-4)', transition: 'transform .15s', transform: promptOpen ? 'rotate(180deg)' : 'none' }}>
                    expand_more
                  </span>
                </div>

                {/* Prompt picker dropdown */}
                {promptOpen && (
                  <div style={{
                    marginTop: 6, border: '1px solid var(--line-2)',
                    borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                    background: 'var(--surface)', boxShadow: 'var(--shadow-md)',
                    maxHeight: 320, overflowY: 'auto',
                  }}>
                    {/* Generic option */}
                    <div
                      onClick={() => { onChange({ llmPromptKey: '' }); setPromptOpen(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px', cursor: 'pointer',
                        background: !state.llmPromptKey ? 'var(--accent-soft)' : 'transparent',
                        borderBottom: '1px solid var(--line)',
                        transition: 'background .1s',
                      }}
                      onMouseEnter={e => { if (state.llmPromptKey) e.currentTarget.style.background = 'var(--bg-2)'; }}
                      onMouseLeave={e => { if (state.llmPromptKey) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span className="mi" style={{ fontSize: 16, color: !state.llmPromptKey ? 'var(--accent)' : 'var(--ink-4)', flexShrink: 0 }}>
                        {!state.llmPromptKey ? 'check_circle' : 'auto_awesome'}
                      </span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: !state.llmPromptKey ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
                          generic
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 1 }}>
                          Uses the default fallback prompt
                        </div>
                      </div>
                    </div>

                    {/* Prompt entries grouped by file */}
                    {(() => {
                      const byFile = prompts.reduce((acc, p) => {
                        (acc[p.file] = acc[p.file] || []).push(p);
                        return acc;
                      }, {});
                      return Object.entries(byFile).map(([file, items]) => (
                        <div key={file}>
                          <div style={{
                            padding: '5px 12px', fontSize: 10, fontWeight: 600,
                            letterSpacing: '.07em', textTransform: 'uppercase',
                            color: 'var(--ink-4)', background: 'var(--bg-2)',
                            borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)',
                          }}>
                            {file}
                          </div>
                          {items.map(p => {
                            const active = state.llmPromptKey === p.key;
                            return (
                              <div
                                key={p.key}
                                onClick={() => { onChange({ llmPromptKey: p.key }); setPromptOpen(false); }}
                                style={{
                                  display: 'flex', alignItems: 'flex-start', gap: 10,
                                  padding: '9px 12px', cursor: 'pointer',
                                  background: active ? 'var(--accent-soft)' : 'transparent',
                                  borderBottom: '1px solid var(--line)',
                                  transition: 'background .1s',
                                }}
                                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-2)'; }}
                                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                              >
                                <span className="mi" style={{ fontSize: 16, color: active ? 'var(--accent)' : 'var(--ink-4)', flexShrink: 0, marginTop: 1 }}>
                                  {active ? 'check_circle' : 'smart_toy'}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{
                                    fontFamily: "'Geist Mono', monospace", fontSize: 12, fontWeight: 500,
                                    color: active ? 'var(--accent-ink)' : 'var(--ink)',
                                  }}>
                                    {p.key}
                                  </div>
                                  <div style={{
                                    fontSize: 11, color: 'var(--ink-3)', marginTop: 2,
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                  }}>
                                    {p.preview}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ));
                    })()}

                    {prompts.length === 0 && (
                      <div style={{ padding: '14px 12px', fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>
                        No prompt files found in config/signals/prompts/
                      </div>
                    )}
                  </div>
                )}

                {/* has_final_eval badge on selected prompt summary */}
                {!promptOpen && state.llmPromptKey && selectedPrompt?.has_final_eval && (
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span className="mi" style={{ fontSize: 13, color: 'var(--accent)' }}>account_tree</span>
                    <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>Final eval prompt configured</span>
                  </div>
                )}
              </div>
            </div>

            {/* Final eval prompt editor — shown when a specific prompt key is selected */}
            {state.llmPromptKey && (
              <div style={{ borderTop: '1px solid var(--line)', padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0, paddingTop: 4 }}>
                    Final eval
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6, lineHeight: 1.5 }}>
                      Prompt used to aggregate per-window verdicts into a final decision. Leave empty to use the default aggregation logic.
                    </div>
                    {finalEvalLoading ? (
                      <div style={{ fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>Loading…</div>
                    ) : (
                      <>
                        <textarea
                          value={finalEvalText}
                          onChange={e => { setFinalEvalText(e.target.value); setFinalEvalMsg(null); }}
                          placeholder={`Leave empty to use the default aggregation prompt.\n\nUse {verdicts_block} in your text to include the per-window verdict list.`}
                          rows={7}
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            fontFamily: "'Geist Mono', monospace", fontSize: 11,
                            padding: '8px 10px', resize: 'vertical',
                            background: 'var(--surface)', color: 'var(--ink)',
                            border: '1px solid var(--line-2)', borderRadius: 'var(--radius-sm)',
                            lineHeight: 1.5,
                          }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                          <button
                            className="tb-btn"
                            disabled={finalEvalSaving || finalEvalText === finalEvalOrig}
                            onClick={saveFinalEval}
                            style={{ fontSize: 12, padding: '4px 12px' }}
                          >
                            {finalEvalSaving ? 'Saving…' : 'Save final eval'}
                          </button>
                          {finalEvalText !== finalEvalOrig && !finalEvalSaving && (
                            <button
                              style={{ fontSize: 11, color: 'var(--ink-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                              onClick={() => { setFinalEvalText(finalEvalOrig); setFinalEvalMsg(null); }}
                            >
                              Revert
                            </button>
                          )}
                          {finalEvalMsg && (
                            <span style={{ fontSize: 11, color: finalEvalMsg.ok ? 'var(--accent)' : 'var(--sev-alarm)', fontWeight: 500 }}>
                              {finalEvalMsg.text}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <WebhookSection action={state.action} state={state} onChange={onChange} />
      </div>

      {exists && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 6, background: 'var(--sev-notify-bg)', border: '1px solid var(--sev-notify)', color: 'var(--sev-notify)', fontSize: 13 }}>
          <span className="mi">warning</span>
          The ID <strong style={{ fontFamily: 'monospace' }}>{state.signalId}</strong> already exists. Saving will overwrite it.
        </div>
      )}
    </div>
  );
}

// ─── SignalEditForm ───────────────────────────────────────────────────────────
function SignalEditForm({ signal, cameras, zonesByCam, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    name: signal.name || signal.id,
    phrase: signal.text,
    priority: signal.priority,
    action: signal.default_action,
    threshold: signal.default_threshold,
    zones: signal.zone || [],
    llmCheck: signal.escalation_llm,
    llmPromptKey: signal.llm_prompt_key || '',
    webhookNotifyUrl: signal.webhook?.notify?.url || '',
    webhookAlarmPrimaryUrl: signal.webhook?.alarm_primary?.url || '',
    webhookAlarmPrimaryRetries: signal.webhook?.alarm_primary?.retries ?? 3,
    webhookAlarmFallbackUrl: signal.webhook?.alarm_fallback?.url || '',
    webhookAlarmFallbackRetries: signal.webhook?.alarm_fallback?.retries ?? 2,
  }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [promptOpen, setPromptOpen] = useState(false);
  const [finalEvalText, setFinalEvalText] = useState('');
  const [finalEvalOrig, setFinalEvalOrig] = useState('');
  const [finalEvalLoading, setFinalEvalLoading] = useState(false);
  const [finalEvalSaving, setFinalEvalSaving] = useState(false);
  const [finalEvalMsg, setFinalEvalMsg] = useState(null);

  const update = patch => setForm(s => ({ ...s, ...patch }));

  const allZones = useMemo(() => {
    const names = new Set();
    for (const cam of cameras) {
      for (const z of (zonesByCam[cam.id] || [])) {
        if (z.type === 'include') names.add(z.name);
      }
    }
    return [...names];
  }, [cameras, zonesByCam]);

  useEffect(() => { setupApi.getPrompts().then(setPrompts).catch(() => {}); }, []);

  useEffect(() => {
    if (!form.llmCheck || !form.llmPromptKey) { setFinalEvalText(''); setFinalEvalOrig(''); return; }
    setFinalEvalLoading(true);
    setFinalEvalMsg(null);
    setupApi.getPromptDetail(form.llmPromptKey)
      .then(d => { const t = d.final_eval || ''; setFinalEvalText(t); setFinalEvalOrig(t); })
      .catch(() => { setFinalEvalText(''); setFinalEvalOrig(''); })
      .finally(() => setFinalEvalLoading(false));
  }, [form.llmPromptKey, form.llmCheck]);

  const saveFinalEval = async () => {
    setFinalEvalSaving(true);
    setFinalEvalMsg(null);
    try {
      await setupApi.patchPrompt(form.llmPromptKey, { final_eval: finalEvalText || null });
      setFinalEvalOrig(finalEvalText);
      setFinalEvalMsg({ ok: true, text: 'Saved' });
    } catch (e) {
      setFinalEvalMsg({ ok: false, text: e.message });
    } finally {
      setFinalEvalSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(signal.id, form);
    } catch (err) {
      setSaveError(err.message);
      setSaving(false);
    }
  };

  const canSave = form.name.length >= 2 && form.phrase.length > 0;
  const selectedPrompt = prompts.find(p => p.key === form.llmPromptKey);
  const toggleZone = name => update({ zones: form.zones.includes(name) ? form.zones.filter(z => z !== name) : [...form.zones, name] });

  return (
    <div className="setup-page">
      <div className="setup-breadcrumb">
        <button onClick={onCancel}>Setup</button><span className="sep">/</span>
        <button onClick={onCancel}>Signals</button><span className="sep">/</span>
        <span className="current">{signal.id}</span>
      </div>
      <div className="setup-page-head">
        <div>
          <h1 className="setup-page-title">Edit · <span style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{signal.id}</span></h1>
          <p className="setup-page-sub">Modify the signal configuration directly.</p>
        </div>
      </div>

      <div className="setup-wizard-card" style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="setup-form-row">
          <label className="setup-form-label">Name</label>
          <input className="setup-form-input" value={form.name}
            onChange={e => update({ name: e.target.value })}
            placeholder="Signal display name" />
        </div>

        <div className="setup-form-row">
          <label className="setup-form-label">Semantic phrase</label>
          <textarea className="setup-form-textarea" value={form.phrase}
            onChange={e => update({ phrase: e.target.value })}
            placeholder="Embedding-optimized description of the event" />
        </div>

        <div className="setup-form-row split">
          <div>
            <label className="setup-form-label">Priority</label>
            <div className="setup-pri-pills">
              {[1, 2, 3, 4, 5].map(p => (
                <div key={p} className={`setup-pri-pill p${p} ${form.priority === p ? 'on' : ''}`}
                  onClick={() => update({ priority: p })}>{p}</div>
              ))}
            </div>
            <span className="setup-form-hint">P1 critical · P5 informational</span>
          </div>
          <div>
            <label className="setup-form-label">Action</label>
            <select className="setup-form-select" value={form.action}
              onChange={e => update({ action: e.target.value })}>
              <option value="statistic">statistic — log only</option>
              <option value="notify">notify — queue for review</option>
              <option value="alarm">alarm — immediate escalation</option>
            </select>
          </div>
        </div>

        <div className="setup-form-row">
          <label className="setup-form-label">
            Threshold <span style={{ fontFamily: 'monospace', marginLeft: 6, color: 'var(--ink)' }}>{form.threshold.toFixed(2)}</span>
          </label>
          <input type="range" min={0.10} max={0.90} step={0.01}
            value={form.threshold}
            onChange={e => update({ threshold: parseFloat(e.target.value) })}
            style={{ width: '100%', accentColor: 'var(--accent)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
            <span>0.10 · sensitive</span><span>strict · 0.90</span>
          </div>
        </div>

        {allZones.length > 0 && (
          <div className="setup-form-row">
            <label className="setup-form-label">Apply to zones</label>
            <div className="setup-zone-chips">
              {allZones.map(name => (
                <div key={name} className={`setup-zone-chip ${form.zones.includes(name) ? 'on' : ''}`}
                  onClick={() => toggleZone(name)}>
                  {form.zones.includes(name) && <span className="mi" style={{ fontSize: 12 }}>check</span>}
                  {name}
                </div>
              ))}
            </div>
            {form.zones.length === 0 && (
              <span className="setup-form-hint">No zones selected — signal applies to any zone</span>
            )}
          </div>
        )}

        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', margin: '8px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderBottom: form.llmCheck ? '1px solid var(--line)' : 'none' }}>
            <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0 }}>LLM check</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className={`setup-sw ${form.llmCheck ? 'on' : ''}`}
                onClick={() => update({ llmCheck: !form.llmCheck, llmPromptKey: !form.llmCheck ? form.llmPromptKey : '' })} />
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {form.llmCheck ? 'Vision LLM will confirm matches above threshold' : 'Recommended for notify and alarm signals'}
              </span>
            </div>
          </div>

          {form.llmCheck && (
            <div style={{ background: 'var(--bg)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '12px 16px' }}>
                <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0, paddingTop: 2 }}>LLM prompt</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    onClick={() => setPromptOpen(v => !v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px',
                      background: 'var(--surface)', border: `1px solid ${promptOpen ? 'var(--accent)' : 'var(--line-2)'}`,
                      borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'border-color .12s',
                    }}
                  >
                    {form.llmPromptKey ? (
                      <>
                        <span className="mi" style={{ fontSize: 16, color: 'var(--accent)', flexShrink: 0 }}>smart_toy</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>{form.llmPromptKey}</div>
                          {selectedPrompt && (
                            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedPrompt.preview}</div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="mi" style={{ fontSize: 16, color: 'var(--ink-4)', flexShrink: 0 }}>auto_awesome</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>generic fallback — no specific prompt selected</div>
                        </div>
                      </>
                    )}
                    <span className="mi" style={{ fontSize: 16, color: 'var(--ink-4)', transition: 'transform .15s', transform: promptOpen ? 'rotate(180deg)' : 'none' }}>expand_more</span>
                  </div>

                  {promptOpen && (
                    <div style={{
                      marginTop: 6, border: '1px solid var(--line-2)', borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden', background: 'var(--surface)', boxShadow: 'var(--shadow-md)',
                      maxHeight: 320, overflowY: 'auto',
                    }}>
                      <div
                        onClick={() => { update({ llmPromptKey: '' }); setPromptOpen(false); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', background: !form.llmPromptKey ? 'var(--accent-soft)' : 'transparent', borderBottom: '1px solid var(--line)', transition: 'background .1s' }}
                        onMouseEnter={e => { if (form.llmPromptKey) e.currentTarget.style.background = 'var(--bg-2)'; }}
                        onMouseLeave={e => { if (form.llmPromptKey) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span className="mi" style={{ fontSize: 16, color: !form.llmPromptKey ? 'var(--accent)' : 'var(--ink-4)', flexShrink: 0 }}>{!form.llmPromptKey ? 'check_circle' : 'auto_awesome'}</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 500, color: !form.llmPromptKey ? 'var(--accent-ink)' : 'var(--ink-2)' }}>generic</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 1 }}>Uses the default fallback prompt</div>
                        </div>
                      </div>
                      {(() => {
                        const byFile = prompts.reduce((acc, p) => { (acc[p.file] = acc[p.file] || []).push(p); return acc; }, {});
                        return Object.entries(byFile).map(([file, items]) => (
                          <div key={file}>
                            <div style={{ padding: '5px 12px', fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink-4)', background: 'var(--bg-2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>{file}</div>
                            {items.map(p => {
                              const active = form.llmPromptKey === p.key;
                              return (
                                <div key={p.key}
                                  onClick={() => { update({ llmPromptKey: p.key }); setPromptOpen(false); }}
                                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', cursor: 'pointer', background: active ? 'var(--accent-soft)' : 'transparent', borderBottom: '1px solid var(--line)', transition: 'background .1s' }}
                                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-2)'; }}
                                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                                >
                                  <span className="mi" style={{ fontSize: 16, color: active ? 'var(--accent)' : 'var(--ink-4)', flexShrink: 0, marginTop: 1 }}>{active ? 'check_circle' : 'smart_toy'}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12, fontWeight: 500, color: active ? 'var(--accent-ink)' : 'var(--ink)' }}>{p.key}</div>
                                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.preview}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ));
                      })()}
                      {prompts.length === 0 && (
                        <div style={{ padding: '14px 12px', fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>No prompt files found in config/signals/prompts/</div>
                      )}
                    </div>
                  )}

                  {!promptOpen && form.llmPromptKey && selectedPrompt?.has_final_eval && (
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span className="mi" style={{ fontSize: 13, color: 'var(--accent)' }}>account_tree</span>
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>Final eval prompt configured</span>
                    </div>
                  )}
                </div>
              </div>

              {form.llmPromptKey && (
                <div style={{ borderTop: '1px solid var(--line)', padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                    <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0, paddingTop: 4 }}>Final eval</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6, lineHeight: 1.5 }}>
                        Prompt used to aggregate per-window verdicts into a final decision. Leave empty to use the default aggregation logic.
                      </div>
                      {finalEvalLoading ? (
                        <div style={{ fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>Loading…</div>
                      ) : (
                        <>
                          <textarea value={finalEvalText}
                            onChange={e => { setFinalEvalText(e.target.value); setFinalEvalMsg(null); }}
                            placeholder={`Leave empty to use the default aggregation prompt.\n\nUse {verdicts_block} in your text to include the per-window verdict list.`}
                            rows={7}
                            style={{ width: '100%', boxSizing: 'border-box', fontFamily: "'Geist Mono', monospace", fontSize: 11, padding: '8px 10px', resize: 'vertical', background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius-sm)', lineHeight: 1.5 }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                            <button className="tb-btn" disabled={finalEvalSaving || finalEvalText === finalEvalOrig} onClick={saveFinalEval} style={{ fontSize: 12, padding: '4px 12px' }}>
                              {finalEvalSaving ? 'Saving…' : 'Save final eval'}
                            </button>
                            {finalEvalText !== finalEvalOrig && !finalEvalSaving && (
                              <button style={{ fontSize: 11, color: 'var(--ink-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                onClick={() => { setFinalEvalText(finalEvalOrig); setFinalEvalMsg(null); }}>Revert</button>
                            )}
                            {finalEvalMsg && (
                              <span style={{ fontSize: 11, color: finalEvalMsg.ok ? 'var(--accent)' : 'var(--sev-alarm)', fontWeight: 500 }}>{finalEvalMsg.text}</span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
          <WebhookSection action={form.action} state={form} onChange={update} />
        </div>
      </div>

      {saveError && (
        <div style={{ maxWidth: 760, margin: '8px auto 0', color: 'var(--sev-alarm)', fontSize: 13, padding: '8px 10px', background: 'var(--sev-alarm-bg)', borderRadius: 6 }}>
          {saveError}
        </div>
      )}
      <div className="setup-wizard-nav" style={{ maxWidth: 760, margin: '24px auto 48px' }}>
        <button className="tb-btn" onClick={onCancel}>Cancel</button>
        <div style={{ flex: 1 }} />
        <button className="tb-btn primary" disabled={!canSave || saving} onClick={handleSave}>
          <span className="mi">save</span>{saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ─── SignalWizard ─────────────────────────────────────────────────────────────
function SignalWizard({ initial, cameras, zonesByCam, existingSignalIds, startStep, onCancel, onSave }) {
  const [step, setStep] = useState(startStep || 1);
  const [state, setState] = useState(() => ({
    signalId: '', name: '', description: '', phrase: '',
    priority: 3, action: 'notify', zones: [],
    camera_id: cameras[0]?.id || '',
    positiveClips: [], negativeClips: [],
    threshold: 0.45, llmCheck: true, llmPromptKey: '',
    editingExisting: false,
    // webhook delivery
    webhookNotifyUrl: '',
    webhookAlarmPrimaryUrl: '',
    webhookAlarmPrimaryRetries: 3,
    webhookAlarmFallbackUrl: '',
    webhookAlarmFallbackRetries: 2,
    ...(initial || {}),
  }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [prompts, setPrompts] = useState([]);

  const update = patch => setState(s => typeof patch === 'function' ? patch(s) : { ...s, ...patch });

  useEffect(() => {
    if (step === 4) {
      if (!state.signalId && state.name) {
        const id = state.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
        update({ signalId: id });
      }
      setupApi.getPrompts().then(setPrompts).catch(() => {});
    }
  }, [step]);

  const canNext = () => {
    if (step === 1) return state.description.length >= 12 && state.phrase.length > 0 && !!state.camera_id;
    if (step === 2) return state.positiveClips.length >= 1;
    if (step === 3) return true;
    if (step === 4) return state.signalId.length >= 3 && state.name.length >= 2;
    return false;
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(state);
    } catch (err) {
      setSaveError(err.message);
      setSaving(false);
    }
  };

  const maxWidth = step === 2 || step === 3 ? 1040 : 760;

  return (
    <div className="setup-page">
      <div className="setup-breadcrumb">
        <button onClick={onCancel}>Setup</button><span className="sep">/</span>
        <button onClick={onCancel}>Signals</button><span className="sep">/</span>
        <span className="current">{state.editingExisting ? state.signalId : 'New signal'}</span>
      </div>
      <div className="setup-page-head">
        <div>
          <h1 className="setup-page-title">{state.editingExisting ? `Edit signal · ${state.signalId}` : 'Create signal'}</h1>
          <p className="setup-page-sub">Calibrated through natural-language description and example clips.</p>
        </div>
      </div>
      <Stepper current={step} />
      {step === 1 && <Step1 state={state} onChange={update} cameras={cameras} zonesByCam={zonesByCam} />}
      {step === 2 && <Step2 state={state} onChange={update} cameras={cameras} />}
      {step === 3 && <Step3 state={state} onChange={update} />}
      {step === 4 && <Step4 state={state} onChange={update} existingSignalIds={existingSignalIds} prompts={prompts} />}
      {saveError && (
        <div style={{ maxWidth, margin: '8px auto 0', color: 'var(--sev-alarm)', fontSize: 13, padding: '8px 10px', background: 'var(--sev-alarm-bg)', borderRadius: 6 }}>
          {saveError}
        </div>
      )}
      <div className="setup-wizard-nav" style={{ maxWidth, margin: '24px auto 48px' }}>
        <button className="tb-btn" onClick={onCancel}>Cancel</button>
        <div style={{ flex: 1 }} />
        {step > 1 && (
          <button className="tb-btn" onClick={() => setStep(s => Math.max(1, s - 1))}>
            <span className="mi">arrow_back</span>Back
          </button>
        )}
        {step < 4 && (
          <button className="tb-btn primary" disabled={!canNext()} onClick={() => setStep(s => Math.min(4, s + 1))}>
            Next: {STEPS[step].label}<span className="mi">arrow_forward</span>
          </button>
        )}
        {step === 4 && (
          <button className="tb-btn primary" disabled={!canNext() || saving} onClick={handleSave}>
            <span className="mi">save</span>{saving ? 'Saving…' : 'Save signal to library'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Setup (main) ─────────────────────────────────────────────────────────────
export function Setup({ username, onLogout }) {
  const navigate = useNavigate();
  const [view, setView] = useState('landing');
  const [formMode, setFormMode] = useState('new');
  const [activeCamId, setActiveCamId] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [areas, setAreas] = useState([]);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [wizardInit, setWizardInit] = useState(null);
  const [wizardStartStep, setWizardStartStep] = useState(1);
  const [editingSignal, setEditingSignal] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    Promise.all([setupApi.getCameras(), setupApi.getAreas(), setupApi.getSignals()])
      .then(([cams, areasData, sigs]) => { setCameras(cams); setAreas(areasData); setSignals(sigs); })
      .catch(err => console.error('Setup load:', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const zonesByCam = useMemo(() => {
    const m = {};
    for (const cam of cameras) m[cam.id] = camZones(cam);
    return m;
  }, [cameras]);

  const activeCam = cameras.find(c => c.id === activeCamId) || null;

  const breadcrumb = {
    landing: null,
    list: 'Cameras',
    form: formMode === 'new' ? 'Cameras / New' : `Cameras / ${activeCamId}`,
    roi: activeCam ? `Cameras / ${activeCam.id} / ROI` : 'Cameras',
    'signals-list': 'Signals',
    'signal-wizard': 'Signals / New',
    'signal-edit': editingSignal ? `Signals / ${editingSignal.id}` : 'Signals',
  }[view];

  const handleCreateCamera = async c => {
    setFormSaving(true);
    setFormError(null);
    try {
      const created = await setupApi.createCamera({
        id: c.id, name: c.name, area: c.area, axis_ip: c.axis_ip || '',
        ...(c.axis_event_id ? { axis_event_id: c.axis_event_id } : {}),
        native_analytics: c.native_analytics || {},
      });
      setCameras(prev => [...prev, created]);
      setActiveCamId(created.id);
      setView('roi');
      setToast(`Camera ${created.id} added`);
    } catch (err) {
      setFormError(err.message);
    }
    setFormSaving(false);
  };

  const handleEditCamera = async c => {
    setFormSaving(true);
    setFormError(null);
    try {
      const updated = await setupApi.patchCamera(c.id, {
        name: c.name, axis_ip: c.axis_ip || '',
        axis_event_id: c.axis_event_id || null,
        native_analytics: c.native_analytics || {},
      });
      setCameras(prev => prev.map(x => x.id === c.id ? { ...x, ...updated } : x));
      setView('list');
      setToast(`Camera ${c.id} updated`);
    } catch (err) {
      setFormError(err.message);
    }
    setFormSaving(false);
  };

  const handleDeleteCamera = async id => {
    try {
      await setupApi.deleteCamera(id);
      setCameras(prev => prev.filter(c => c.id !== id));
      setToast(`Camera ${id} deleted`);
    } catch (err) {
      setToast(`Delete failed: ${err.message}`);
    }
  };

  const handleSaveRoi = async apiZones => {
    await setupApi.patchCamera(activeCamId, {
      preprocessing: { roi: { enabled: apiZones.length > 0, zones: apiZones } },
    });
    setCameras(prev => prev.map(c => c.id === activeCamId ? {
      ...c,
      preprocessing: { ...c.preprocessing, roi: { enabled: apiZones.length > 0, zones: apiZones } },
    } : c));
  };

  const buildWebhookBody = (s) => {
    if (s.action === 'notify' && s.webhookNotifyUrl) {
      return { notify: { url: s.webhookNotifyUrl, retries: 3 } };
    }
    if (s.action === 'alarm') {
      const wh = {};
      if (s.webhookAlarmPrimaryUrl) wh.alarm_primary = { url: s.webhookAlarmPrimaryUrl, retries: s.webhookAlarmPrimaryRetries };
      if (s.webhookAlarmFallbackUrl) wh.alarm_fallback = { url: s.webhookAlarmFallbackUrl, retries: s.webhookAlarmFallbackRetries };
      return Object.keys(wh).length ? wh : null;
    }
    return null;
  };

  const handleSaveSignal = async wizState => {
    const webhook = buildWebhookBody(wizState);
    const body = {
      id: wizState.signalId,
      name: wizState.name,
      text: wizState.phrase,
      priority: wizState.priority,
      default_action: wizState.action,
      default_threshold: wizState.threshold,
      escalation_llm: wizState.llmCheck,
      llm_prompt_key: wizState.llmCheck && wizState.llmPromptKey ? wizState.llmPromptKey : null,
      zone: wizState.zones.length > 0 ? wizState.zones : null,
      source: 'embedder',
      cooldown_sec: 300,
      ...(webhook ? { webhook } : {}),
    };
    if (wizState.editingExisting) {
      const { id, ...patch } = body;
      const updated = await setupApi.patchSignal(wizState.signalId, patch);
      setSignals(prev => prev.map(s => s.id === wizState.signalId ? { ...s, ...updated } : s));
    } else {
      const created = await setupApi.createSignal(body);
      setSignals(prev => [...prev, created]);
    }
    setView('signals-list');
    setToast(`Signal ${wizState.signalId} saved`);
  };

  const handleDeleteSignal = async id => {
    try {
      await setupApi.deleteSignal(id);
      setSignals(prev => prev.filter(s => s.id !== id));
      setToast(`Signal ${id} deleted`);
    } catch (err) {
      setToast(`Delete failed: ${err.message}`);
    }
  };

  const handleEditSignalDirect = async (id, form) => {
    const webhook = buildWebhookBody({ action: form.action, ...form });
    const patch = {
      name: form.name,
      text: form.phrase,
      priority: form.priority,
      default_action: form.action,
      default_threshold: form.threshold,
      escalation_llm: form.llmCheck,
      llm_prompt_key: form.llmCheck && form.llmPromptKey ? form.llmPromptKey : null,
      zone: form.zones.length > 0 ? form.zones : null,
      ...(webhook ? { webhook } : { webhook: null }),
    };
    const updated = await setupApi.patchSignal(id, patch);
    setSignals(prev => prev.map(s => s.id === id ? { ...s, ...updated } : s));
    setView('signals-list');
    setToast(`Signal ${id} saved`);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--ink-3)', fontSize: 14 }}>
        Loading setup…
      </div>
    );
  }

  return (
    <div style={view === 'roi'
      ? { height: '100vh', overflow: 'hidden', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }
      : { minHeight: '100vh', background: 'var(--bg)' }
    }>
      <TopNav username={username} onLogout={onLogout} onHome={() => navigate('/')} breadcrumb={breadcrumb} />

      {view === 'landing' && (
        <Landing camerasCount={cameras.length} signalsCount={signals.length}
          onPick={k => { if (k === 'cameras') setView('list'); else if (k === 'signals') setView('signals-list'); else if (k === 'site') navigate('/setup/site'); }} />
      )}
      {view === 'list' && (
        <CameraList cameras={cameras} onBack={() => setView('landing')}
          onNew={() => { setActiveCamId(null); setFormMode('new'); setFormError(null); setView('form'); }}
          onEdit={id => { setActiveCamId(id); setFormMode('edit'); setFormError(null); setView('form'); }}
          onRoi={id => { setActiveCamId(id); setView('roi'); }}
          onDelete={handleDeleteCamera} />
      )}
      {view === 'form' && (
        <CameraForm mode={formMode} areas={areas} saving={formSaving} error={formError}
          initial={formMode === 'edit' ? cameras.find(c => c.id === activeCamId) : null}
          onCancel={() => setView('list')}
          onSave={formMode === 'new' ? handleCreateCamera : handleEditCamera} />
      )}
      {view === 'roi' && activeCam && (
        <RoiEditor camera={activeCam}
          initialZones={zonesByCam[activeCam.id] || []}
          onSave={handleSaveRoi}
          onCancel={() => setView('list')} />
      )}
      {view === 'signals-list' && (
        <SignalList signals={signals} onBack={() => setView('landing')}
          onNew={() => { setWizardInit(null); setWizardStartStep(1); setView('signal-wizard'); }}
          onEdit={s => { setEditingSignal(s); setView('signal-edit'); }}
          onDelete={handleDeleteSignal} />
      )}
      {view === 'signal-wizard' && (
        <SignalWizard initial={wizardInit} startStep={wizardStartStep}
          cameras={cameras} zonesByCam={zonesByCam}
          existingSignalIds={signals.map(s => s.id)}
          onCancel={() => setView('signals-list')}
          onSave={handleSaveSignal} />
      )}
      {view === 'signal-edit' && editingSignal && (
        <SignalEditForm signal={editingSignal}
          cameras={cameras} zonesByCam={zonesByCam}
          onCancel={() => setView('signals-list')}
          onSave={handleEditSignalDirect} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
