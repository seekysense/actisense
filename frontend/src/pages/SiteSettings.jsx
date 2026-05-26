import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const BASE_URL = import.meta.env.VITE_API_URL || '';
const getToken = () => localStorage.getItem('vsa_token');

async function req(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
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

const AREA_TYPE_LABELS = {
  indoor_public: 'Indoor public',
  indoor_restricted: 'Indoor restricted',
  outdoor: 'Outdoor',
};

const PRIORITY_LABELS = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low', 5: 'Info' };
const PRIORITY_COLORS = {
  1: 'var(--sev-alarm)', 2: 'var(--sev-notify)',
  3: 'var(--accent)', 4: 'var(--ink-3)', 5: 'var(--ink-4)',
};

function SectionHead({ icon, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginBottom: 16, paddingBottom: 12,
      borderBottom: '1px solid var(--line)',
    }}>
      <span className="mi" style={{ fontSize: 18, color: 'var(--ink-3)' }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>{label}</span>
    </div>
  );
}

function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div style={{
      marginBottom: 20, padding: '10px 14px',
      borderRadius: 'var(--radius-sm)',
      border: `1px solid ${toast.ok ? 'var(--ok-bg)' : 'var(--sev-alarm-bg)'}`,
      background: toast.ok ? 'var(--ok-bg)' : 'var(--sev-alarm-bg)',
      color: toast.ok ? 'var(--ok)' : 'var(--sev-alarm)',
      fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span className="mi" style={{ fontSize: 16 }}>{toast.ok ? 'check_circle' : 'error'}</span>
        {toast.msg}
      </span>
      <button onClick={onDismiss} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'inherit', fontSize: 18, lineHeight: 1, padding: '0 2px', opacity: .7,
      }}>×</button>
    </div>
  );
}

// ── Area editor (expanded card) ──────────────────────────────────────────────

function AreaEditor({ area, allSignals, allCameras, onSave, onCancel }) {
  const [name, setName] = useState(area.name || '');
  const [cooldown, setCooldown] = useState(area.alert_cooldown_sec ?? '');

  // Current cameras from area
  const [cameras, setCameras] = useState(new Set(area.cameras || []));

  // Signals: current area signal IDs
  const currentSignalIds = new Set(
    (area.signals || []).map(s => (typeof s === 'string' ? s : s.id))
  );
  const [enabledSignals, setEnabledSignals] = useState(new Set(currentSignalIds));

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const toggleCamera = (camId) => {
    setCameras(prev => {
      const n = new Set(prev);
      n.has(camId) ? n.delete(camId) : n.add(camId);
      return n;
    });
  };

  const toggleSignal = (sigId) => {
    setEnabledSignals(prev => {
      const n = new Set(prev);
      n.has(sigId) ? n.delete(sigId) : n.add(sigId);
      return n;
    });
  };

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      // 1. Patch area metadata + cameras
      await req(`/api/config/areas/${area.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim() || undefined,
          alert_cooldown_sec: cooldown !== '' ? Number(cooldown) : undefined,
          cameras: [...cameras],
        }),
      });

      // 2. Compute signal diff
      const toAdd = [...enabledSignals].filter(id => !currentSignalIds.has(id));
      const toRemove = [...currentSignalIds].filter(id => !enabledSignals.has(id));

      await Promise.all([
        ...toAdd.map(id =>
          req(`/api/config/areas/${area.id}/signals`, {
            method: 'POST',
            body: JSON.stringify({ id }),
          })
        ),
        ...toRemove.map(id =>
          req(`/api/config/areas/${area.id}/signals/${id}`, { method: 'DELETE' })
        ),
      ]);

      onSave();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Group signals by priority
  const byPriority = allSignals.reduce((acc, s) => {
    const p = s.priority || 3;
    (acc[p] = acc[p] || []).push(s);
    return acc;
  }, {});

  return (
    <div style={{ padding: '16px', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
      {err && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 'var(--radius-sm)',
          background: 'var(--sev-alarm-bg)', color: 'var(--sev-alarm)', fontSize: 12,
        }}>{err}</div>
      )}

      {/* Row 1: name + cooldown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label className="setup-form-label">Area name</label>
          <input
            className="setup-form-input"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="setup-form-label">Alert cooldown (sec)</label>
          <input
            className="setup-form-input"
            type="number" min="0"
            value={cooldown}
            onChange={e => setCooldown(e.target.value)}
            placeholder="inherit from site"
          />
          <div className="setup-form-hint">Leave empty to inherit site default</div>
        </div>
      </div>

      {/* Row 2: cameras */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>
          Cameras
          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-4)', fontWeight: 400 }}>
            {cameras.size} selected
          </span>
        </div>
        {allCameras.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>
            No cameras configured yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allCameras.map(c => {
              const on = cameras.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCamera(c.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--line-2)'}`,
                    background: on ? 'var(--accent-soft)' : 'var(--surface)',
                    color: on ? 'var(--accent-ink)' : 'var(--ink-3)',
                    fontSize: 11.5, fontFamily: "'Geist Mono', monospace",
                    cursor: 'pointer', transition: 'all .12s',
                  }}
                >
                  <span className="mi" style={{ fontSize: 13 }}>
                    {on ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  {c.id}
                  {c.name !== c.id && (
                    <span style={{ color: on ? 'var(--accent)' : 'var(--ink-4)', opacity: .8 }}>
                      {' '}{c.name}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Row 3: signals by priority */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>
          Signals
          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-4)', fontWeight: 400 }}>
            {enabledSignals.size} enabled
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3, 4, 5].map(p => {
            const sigs = byPriority[p];
            if (!sigs?.length) return null;
            return (
              <div key={p}>
                <div style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase',
                  color: PRIORITY_COLORS[p], marginBottom: 5,
                }}>
                  P{p} — {PRIORITY_LABELS[p]}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {sigs.map(s => {
                    const on = enabledSignals.has(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleSignal(s.id)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '4px 9px', borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${on ? PRIORITY_COLORS[p] + '66' : 'var(--line-2)'}`,
                          background: on ? PRIORITY_COLORS[p] + '18' : 'var(--surface)',
                          color: on ? PRIORITY_COLORS[p] : 'var(--ink-3)',
                          fontSize: 11.5, cursor: 'pointer', transition: 'all .12s',
                        }}
                      >
                        <span className="mi" style={{ fontSize: 12 }}>
                          {on ? 'check_box' : 'check_box_outline_blank'}
                        </span>
                        {s.name || s.id}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer buttons */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--line)' }}>
        <button className="tb-btn" onClick={onCancel} style={{ cursor: 'pointer' }}>Cancel</button>
        <button
          className="tb-btn primary"
          onClick={handleSave}
          disabled={saving}
          style={{ cursor: saving ? 'default' : 'pointer' }}
        >
          <span className="mi" style={{ fontSize: 14 }}>save</span>
          {saving ? 'Saving…' : 'Save area'}
        </button>
      </div>
    </div>
  );
}

// ── Area card (collapsed + expanded) ────────────────────────────────────────

function AreaCard({ area, allSignals, allCameras, onSaved }) {
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState(null);

  const signalIds = (area.signals || []).map(s => (typeof s === 'string' ? s : s.id));
  const camCount = (area.cameras || []).length;

  function handleSaved() {
    setExpanded(false);
    setToast({ ok: true, msg: 'Area saved.' });
    onSaved();
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
      borderColor: expanded ? 'var(--accent)' : 'var(--line)',
      transition: 'border-color .15s',
    }}>
      {/* Header row */}
      <div
        style={{
          display: 'grid', gridTemplateColumns: '1fr auto',
          alignItems: 'center', padding: '14px 16px', gap: 12,
          cursor: 'pointer',
          background: expanded ? 'var(--accent-soft)' : 'var(--surface)',
          transition: 'background .15s',
        }}
        onClick={() => setExpanded(v => !v)}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{area.name}</span>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '.04em',
              padding: '1px 7px', borderRadius: 999,
              background: expanded ? 'var(--accent-soft)' : 'var(--bg-2)',
              color: expanded ? 'var(--accent-ink)' : 'var(--ink-3)',
              border: '1px solid var(--line)',
            }}>
              {AREA_TYPE_LABELS[area.type] || area.type}
            </span>
          </div>
          <div style={{
            display: 'flex', gap: 10, alignItems: 'center',
            fontSize: 11.5, color: 'var(--ink-3)',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="mi" style={{ fontSize: 13 }}>videocam</span>
              {camCount} cam{camCount !== 1 ? 's' : ''}
            </span>
            <span className="dot-sep" />
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="mi" style={{ fontSize: 13 }}>sensors</span>
              {signalIds.length} signals
            </span>
            {area.alert_cooldown_sec != null && (
              <>
                <span className="dot-sep" />
                <span>{area.alert_cooldown_sec}s cooldown</span>
              </>
            )}
          </div>
          {(area.cameras || []).length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              {(area.cameras || []).map(c => (
                <span key={c} style={{
                  fontFamily: "'Geist Mono', monospace", fontSize: 10,
                  padding: '1px 6px', borderRadius: 4,
                  background: 'var(--bg-2)', border: '1px solid var(--line)',
                  color: 'var(--ink-3)',
                }}>{c}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {toast && (
            <span style={{
              fontSize: 11.5, color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span className="mi" style={{ fontSize: 14 }}>check_circle</span>
              Saved
            </span>
          )}
          <span className="mi" style={{
            fontSize: 20, color: expanded ? 'var(--accent)' : 'var(--ink-4)',
            transition: 'transform .15s, color .15s',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>
            expand_more
          </span>
        </div>
      </div>

      {/* Editor */}
      {expanded && (
        <AreaEditor
          area={area}
          allSignals={allSignals}
          allCameras={allCameras}
          onSave={handleSaved}
          onCancel={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

// ── Main SiteSettings page ───────────────────────────────────────────────────

export function SiteSettings() {
  const navigate = useNavigate();
  const [site, setSite] = useState(null);
  const [areas, setAreas] = useState([]);
  const [signals, setSignals] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [loadErr, setLoadErr] = useState(null);

  async function load() {
    try {
      const [s, a, sigs, cams] = await Promise.all([
        req('/api/config/site'),
        req('/api/config/areas'),
        req('/api/config/signals'),
        req('/api/config/cameras'),
      ]);
      setSite(s);
      setAreas(a);
      setSignals(sigs);
      setCameras(cams);
    } catch (err) {
      setLoadErr(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  const onChange = (field) => (e) =>
    setSite(s => ({ ...s, [field]: e.target.value }));

  async function saveSite() {
    setSaving(true);
    setToast(null);
    try {
      const updated = await req('/api/config/site', {
        method: 'PATCH',
        body: JSON.stringify({
          name: site.name?.trim(),
          alert_cooldown_sec: Number(site.alert_cooldown_sec) || 0,
          webhook_url: site.webhook_url?.trim() || null,
        }),
      });
      setSite(updated);
      setToast({ ok: true, msg: 'Site settings saved.' });
    } catch (err) {
      setToast({ ok: false, msg: `Save failed: ${err.message}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Top nav ── */}
      <header className="setup-topnav">
        <div className="setup-topnav-left">
          <button className="setup-topnav-back" onClick={() => navigate('/setup')}>
            <span className="mi">arrow_back</span>
            Setup
          </button>
          <span className="setup-topnav-title">
            <span className="setup-topnav-crumb">Site /</span>{' '}
            {site ? site.name : 'Settings'}
          </span>
        </div>
        <div className="setup-topnav-right" />
      </header>

      {loadErr ? (
        <div className="setup-page">
          <div style={{
            padding: '12px 16px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--sev-alarm-bg)', background: 'var(--sev-alarm-bg)',
            color: 'var(--sev-alarm)', fontSize: 13,
          }}>
            Failed to load: {loadErr}
          </div>
        </div>
      ) : !site ? (
        <div className="loading">Loading site…</div>
      ) : (
        <div className="setup-page">

          <div className="setup-breadcrumb">
            <button onClick={() => navigate('/setup')}>Setup</button>
            <span className="sep">/</span>
            <span className="current">Site settings</span>
          </div>

          <div className="setup-page-head">
            <div>
              <h1 className="setup-page-title">Site settings</h1>
              <p className="setup-page-sub">
                Edit site metadata and configure areas — cameras and active signals per area.
              </p>
            </div>
          </div>

          <Toast toast={toast} onDismiss={() => setToast(null)} />

          {/* ── Site identity card ── */}
          <div className="setup-form-card" style={{ maxWidth: 'none', margin: '0 0 24px' }}>
            <SectionHead icon="apartment" label="Identity & configuration" />

            <div className="setup-form-row split">
              <div>
                <label className="setup-form-label">Site name</label>
                <input
                  className="setup-form-input"
                  value={site.name || ''}
                  onChange={onChange('name')}
                  placeholder="e.g. The Castelletto"
                />
              </div>
              <div>
                <label className="setup-form-label">Site ID</label>
                <input className="setup-form-input locked" value={site.id || ''} readOnly />
                <div className="setup-form-hint">Immutable — edit in site.yaml</div>
              </div>
            </div>

            <div className="setup-form-row split">
              <div>
                <label className="setup-form-label">Site type</label>
                <input className="setup-form-input locked" value={site.type || ''} readOnly />
                <div className="setup-form-hint">Edit in site.yaml</div>
              </div>
              <div>
                <label className="setup-form-label">Global alert cooldown (sec)</label>
                <input
                  className="setup-form-input"
                  type="number" min="0"
                  value={site.alert_cooldown_sec ?? 0}
                  onChange={onChange('alert_cooldown_sec')}
                />
                <div className="setup-form-hint">Default for areas without their own cooldown</div>
              </div>
            </div>

            <div className="setup-form-row">
              <label className="setup-form-label">Default webhook URL</label>
              <input
                className="setup-form-input mono"
                value={site.webhook_url || ''}
                onChange={onChange('webhook_url')}
                placeholder="https://hooks.example.com/alerts"
                type="url"
              />
              <div className="setup-form-hint">
                Overrides <span className="mono">WEBHOOK_DEFAULT_URL</span> from .env.
              </div>
            </div>

            <div style={{
              display: 'flex', justifyContent: 'flex-end',
              paddingTop: 16, borderTop: '1px solid var(--line)', marginTop: 4,
            }}>
              <button
                className="tb-btn primary"
                style={{ cursor: saving ? 'default' : 'pointer' }}
                onClick={saveSite}
                disabled={saving}
              >
                <span className="mi" style={{ fontSize: 15 }}>save</span>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {/* ── Areas section ── */}
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mi" style={{ fontSize: 18, color: 'var(--ink-3)' }}>grid_view</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>Areas</span>
                <span style={{
                  fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-4)',
                  background: 'var(--bg-2)', border: '1px solid var(--line)',
                  borderRadius: 999, padding: '1px 8px',
                }}>{areas.length}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                Click an area to expand and edit
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {areas.map(a => (
                <AreaCard
                  key={a.id}
                  area={a}
                  allSignals={signals}
                  allCameras={cameras}
                  onSaved={load}
                />
              ))}
              {areas.length === 0 && (
                <div className="setup-empty">
                  <span className="mi">grid_off</span>
                  No areas configured. Add areas in site.yaml.
                </div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

export default SiteSettings;
