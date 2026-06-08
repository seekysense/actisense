import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from 'react-router-dom'
import { useConfig } from '@/hooks/useConfig'
import { useAuthStore } from '@/stores/authStore'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Camera, Pencil, MousePointer, Eye, Save, X,
  ChevronDown, ChevronRight, Loader2,
} from 'lucide-react'

const W = 1920
const H = 1080
const SNAP_THRESH = 40  // SVG coordinate units to snap to first point

// ── Helpers ─────────────────────────────────────────────────────────────────
const strokeFor = (z) => z.exclude ? 'rgba(255,80,80,0.92)' : 'rgba(40,200,130,0.92)'
const fillFor   = (z) => z.exclude ? 'rgba(255,80,80,0.18)' : 'rgba(40,200,130,0.18)'
const centroid  = (pts) =>
  pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0])
const ptsStr    = (pts) => pts.map((p) => p.join(',')).join(' ')

// Accurate SVG coordinate conversion using getScreenCTM (handles any CSS transform/scale)
function useSvgCoords(svgRef) {
  return useCallback((e) => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const sp = pt.matrixTransform(svg.getScreenCTM().inverse())
    return [
      Math.max(0, Math.min(W, Math.round(sp.x))),
      Math.max(0, Math.min(H, Math.round(sp.y))),
    ]
  }, [svgRef])
}

// Convert zones from API format to internal working format
function apiZonesToInternal(zones) {
  return (zones || []).map((z, i) => ({
    ...z,
    _id: `z${i}_${Math.random().toString(36).slice(2, 5)}`,
    polygon: z.polygon || [],
    exclude: !!z.exclude,
    rotation: z.rotation || 0,
    perspective_quad: z.perspective_quad || null,
    expanded: false,
  }))
}

// ── Main component ───────────────────────────────────────────────────────────
export default function RoiEditor() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { refetch: refetchConfig } = useConfig()
  const isAdmin = useAuthStore((s) => s.role) === 'admin'

  // Full camera data fetched directly (includes preprocessing.roi.zones)
  const [camera, setCamera]         = useState(null)
  const [loadingCamera, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/api/config/cameras/${id}`)
      .then((data) => {
        setCamera(data)
        setZones(apiZonesToInternal(data?.preprocessing?.roi?.zones))
      })
      .catch((err) => toast.error(`Camera load failed: ${err.message}`))
      .finally(() => setLoading(false))
  }, [id])

  // ── Zone state ──────────────────────────────────────────────────────────────
  const [zones, setZones] = useState([])

  // ── Draw state ──────────────────────────────────────────────────────────────
  const [mode, setMode]           = useState('select')
  const [draftPts, setDraftPts]   = useState([])
  const [hoverPt, setHoverPt]     = useState(null)
  const [snapFirst, setSnapFirst] = useState(false)
  const [selected, setSelected]   = useState(null)

  // ── Snapshot ────────────────────────────────────────────────────────────────
  const [snapshotUrl, setSnapshotUrl]         = useState(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  // ── Naming dialog ───────────────────────────────────────────────────────────
  const [naming, setNaming]     = useState(null)
  const [nameVal, setNameVal]   = useState('')
  const [nameType, setNameType] = useState('include')

  // ── Preview / saving ────────────────────────────────────────────────────────
  const [preview, setPreview] = useState(null)
  const [saving, setSaving]   = useState(false)

  // ── Drag ref ────────────────────────────────────────────────────────────────
  const dragRef = useRef(null)  // { zoneId, ptIdx, isQuad }
  const svgRef  = useRef(null)
  const toSvg   = useSvgCoords(svgRef)

  // Escape cancels draft or naming dialog
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (naming) { setNaming(null); setDraftPts([]) }
        else if (draftPts.length > 0) { setDraftPts([]); setHoverPt(null); setSnapFirst(false) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [naming, draftPts])

  // ── Snapshot ────────────────────────────────────────────────────────────────
  const handleSnapshot = async () => {
    if (!camera?.axis_ip) {
      toast.error('No Axis IP configured for this camera')
      return
    }
    setSnapshotLoading(true)
    try {
      const token = useAuthStore.getState().token
      const res = await fetch(`/api/config/cameras/${id}/snapshot`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      if (snapshotUrl) URL.revokeObjectURL(snapshotUrl)
      setSnapshotUrl(URL.createObjectURL(blob))
      toast.success(t('setup.snapshot_captured'))
    } catch (err) {
      toast.error(`Snapshot: ${err.message}`)
    }
    setSnapshotLoading(false)
  }

  // ── SVG: draw mode ──────────────────────────────────────────────────────────
  const onSvgClick = (e) => {
    if (mode !== 'draw' || !isAdmin) return
    if (dragRef.current) return
    const pos = toSvg(e)

    if (draftPts.length >= 3) {
      const dist = Math.hypot(pos[0] - draftPts[0][0], pos[1] - draftPts[0][1])
      if (dist < SNAP_THRESH) {
        setNaming({ points: draftPts })
        setNameVal(`zone ${zones.length + 1}`)
        setNameType('include')
        setDraftPts([]); setHoverPt(null); setSnapFirst(false)
        return
      }
    }
    setDraftPts((d) => [...d, pos])
  }

  // ── SVG: pointer move — rubber band + drag ──────────────────────────────────
  const onSvgPointerMove = (e) => {
    if (dragRef.current) {
      const pos = toSvg(e)
      const { zoneId, ptIdx, isQuad } = dragRef.current
      setZones((zs) => zs.map((z) => {
        if (z._id !== zoneId) return z
        if (isQuad) {
          const quad = (z.perspective_quad || []).map((p, i) => (i === ptIdx ? pos : p))
          return { ...z, perspective_quad: quad }
        }
        const poly = z.polygon.map((p, i) => (i === ptIdx ? pos : p))
        return { ...z, polygon: poly }
      }))
      return
    }
    if (mode === 'draw' && draftPts.length > 0) {
      const pos = toSvg(e)
      setHoverPt(pos)
      if (draftPts.length >= 3) {
        const dist = Math.hypot(pos[0] - draftPts[0][0], pos[1] - draftPts[0][1])
        setSnapFirst(dist < SNAP_THRESH)
      } else {
        setSnapFirst(false)
      }
    }
  }

  const onSvgPointerUp = () => { dragRef.current = null }

  // ── Point drag start ────────────────────────────────────────────────────────
  const onPointDown = (zoneId, ptIdx, isQuad = false) => (e) => {
    if (mode !== 'select' || !isAdmin) return
    e.stopPropagation()
    dragRef.current = { zoneId, ptIdx, isQuad }
    setSelected(zoneId)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  // ── Zone operations ──────────────────────────────────────────────────────────
  const updateZone      = (id, patch) => setZones((zs) => zs.map((z) => z._id === id ? { ...z, ...patch } : z))
  const deleteZone      = (id) => { setZones((zs) => zs.filter((z) => z._id !== id)); if (selected === id) setSelected(null) }
  const toggleExpand    = (id) => setZones((zs) => zs.map((z) => z._id === id ? { ...z, expanded: !z.expanded } : z))

  const togglePerspective = (z) => {
    if (z.perspective_quad) return updateZone(z._id, { perspective_quad: null })
    const xs = z.polygon.map((p) => p[0]), ys = z.polygon.map((p) => p[1])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    updateZone(z._id, { perspective_quad: [[x0,y0],[x1,y0],[x1,y1],[x0,y1]] })
  }

  const confirmName = () => {
    const newZ = {
      _id: `z_${Date.now()}`,
      name: nameVal || `zone ${zones.length + 1}`,
      polygon: naming.points,
      exclude: nameType === 'exclude',
      rotation: 0,
      perspective_quad: null,
      expanded: true,
    }
    setZones((zs) => [...zs, newZ])
    setSelected(newZ._id)
    toast.success(t('setup.zone_added', { name: newZ.name }))
    setNaming(null)
    setMode('select')
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!isAdmin || !camera) return
    setSaving(true)
    try {
      const cleaned = zones.map((z) => ({
        name: z.name,
        polygon: z.polygon,
        exclude: !!z.exclude,
        rotation: z.rotation ?? 0,
        ...(z.perspective_quad ? { perspective_quad: z.perspective_quad } : {}),
      }))
      await apiFetch(`/api/config/cameras/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ preprocessing: { roi: { enabled: cleaned.length > 0, zones: cleaned } } }),
      })
      toast.success(t('setup.roi_saved'))
      await refetchConfig()
      navigate('/setup/cameras')
    } catch (err) {
      toast.error(err.message || t('errors.saving'))
    }
    setSaving(false)
  }

  // ── Guard ────────────────────────────────────────────────────────────────────
  if (loadingCamera) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={28} className="animate-spin text-ink-4" />
      </div>
    )
  }
  if (!camera) {
    return <div className="text-ink-3 py-10 text-center">{t('setup.camera_not_found')}</div>
  }

  const ptRadius  = 9
  const snapRadius = Math.round(ptRadius * 1.7)

  return (
    <div className="flex flex-col gap-0">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap flex-shrink-0">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-ink">
            {t('setup.roi_editor')} — {camera.name}
          </h1>
          <p className="text-sm text-ink-3 mt-0.5">
            <span className="font-mono">{camera.id}</span>
            {camera.axis_ip && <> · <span className="font-mono">{camera.axis_ip}</span></>}
            {' · '}{zones.length} zone{zones.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/setup/cameras')}>
              {t('common.back')}
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              <Save size={15} />
              {saving ? t('common.saving') : t('setup.save_roi')}
            </Button>
          </div>
        )}
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <Button
          variant="outline" size="sm" className="gap-1.5"
          onClick={handleSnapshot}
          disabled={snapshotLoading}
        >
          {snapshotLoading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          {snapshotLoading ? 'Loading…' : t('setup.get_snapshot')}
        </Button>

        <div className="inline-flex p-[3px] gap-px bg-bg-2 rounded-sm border border-line">
          {[
            { v: 'draw',   Icon: Pencil,       label: t('setup.draw_polygon') },
            { v: 'select', Icon: MousePointer, label: t('setup.select_move') },
          ].map(({ v, Icon, label }) => (
            <button
              key={v}
              onClick={() => {
                setMode(v)
                if (v === 'select') { setDraftPts([]); setHoverPt(null); setSnapFirst(false) }
              }}
              className={`h-7 px-3 rounded-[2px] text-xs font-semibold transition cursor-pointer inline-flex items-center gap-1.5 border-none ${
                mode === v ? 'bg-surface shadow-xs text-ink' : 'bg-transparent text-ink-3 hover:text-ink-2'
              }`}
            >
              <Icon size={13} />{label}
            </button>
          ))}
        </div>

        {draftPts.length > 0 && (
          <Button variant="ghost" size="sm" className="text-ink-3 gap-1"
            onClick={() => { setDraftPts([]); setHoverPt(null); setSnapFirst(false) }}>
            <X size={13} />{t('setup.clear_draft')}
          </Button>
        )}
      </div>

      {/* ── Canvas + zone panel ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_300px] gap-4 items-start">

        {/* ── Canvas ────────────────────────────────────────────────────────── */}
        {/*
          Layout strategy: the outer div has position:relative and no explicit height.
          The SVG (aspectRatio 16/9) defines the container height.
          The snapshot img is absolutely positioned to fill that same space.
          Both share viewBox 0 0 1920 1080, so zone coords map 1:1.
        */}
        <div className="relative rounded-md overflow-hidden border border-line bg-[#0f172a]"
          style={{ aspectRatio: '16/9' }}>

          {/* Snapshot background — fills entire 16:9 container */}
          {snapshotUrl ? (
            <img
              src={snapshotUrl}
              alt="camera snapshot"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Camera size={40} strokeWidth={1.25} className="text-white/15" />
              <span className="text-[13px] text-white/25">{t('setup.no_snapshot')}</span>
            </div>
          )}

          {/* SVG overlay — full size, same aspect ratio */}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="xMidYMid meet"
            style={{ cursor: mode === 'draw' ? 'crosshair' : 'default' }}
            onClick={onSvgClick}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
          >
            {/* ── Saved zones ── */}
            {zones.map((z) => {
              const isSel = z._id === selected
              const dim   = !!selected && !isSel
              const cx    = centroid(z.polygon)
              return (
                <g
                  key={z._id}
                  transform={z.rotation ? `rotate(${z.rotation} ${cx[0]} ${cx[1]})` : undefined}
                  onClick={(e) => { if (mode === 'select') { e.stopPropagation(); setSelected(z._id) } }}
                  style={{ cursor: mode === 'select' ? 'pointer' : 'inherit' }}
                >
                  <polygon
                    points={ptsStr(z.polygon)}
                    fill={fillFor(z)}
                    stroke={isSel ? 'var(--accent)' : strokeFor(z)}
                    strokeWidth={isSel ? 5 : 3}
                    vectorEffect="non-scaling-stroke"
                    opacity={dim ? 0.4 : 1}
                  />
                  {/* perspective quad overlay */}
                  {z.perspective_quad && (
                    <polygon
                      points={ptsStr(z.perspective_quad)}
                      fill="none"
                      stroke="rgba(255,255,100,0.75)"
                      strokeWidth={2}
                      strokeDasharray="14 8"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {/* zone label */}
                  <text
                    x={cx[0]} y={cx[1]}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={52} fontWeight="700" fill="#fff"
                    style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.65)', strokeWidth: 14 }}
                  >
                    {z.name}
                  </text>
                  {/* drag handles (select mode only) */}
                  {isSel && mode === 'select' && z.polygon.map((p, i) => (
                    <circle key={i}
                      cx={p[0]} cy={p[1]} r={ptRadius}
                      fill="#fff" stroke={strokeFor(z)} strokeWidth={3}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: 'grab' }}
                      onPointerDown={onPointDown(z._id, i, false)}
                    />
                  ))}
                  {/* perspective quad handles */}
                  {isSel && mode === 'select' && z.perspective_quad?.map((p, i) => (
                    <circle key={`q${i}`}
                      cx={p[0]} cy={p[1]} r={ptRadius}
                      fill="rgba(255,255,100,0.95)" stroke="rgba(180,150,0,0.9)" strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: 'grab' }}
                      onPointerDown={onPointDown(z._id, i, true)}
                    />
                  ))}
                </g>
              )
            })}

            {/* ── Draft polygon ── */}
            {draftPts.length > 0 && (
              <g>
                {draftPts.length > 1 && (
                  <polyline
                    points={ptsStr(draftPts)}
                    fill="none" stroke="var(--accent)"
                    strokeWidth={3} strokeDasharray="12 8"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {/* rubber band — last point → cursor */}
                {hoverPt && !snapFirst && (
                  <line
                    x1={draftPts[draftPts.length - 1][0]} y1={draftPts[draftPts.length - 1][1]}
                    x2={hoverPt[0]} y2={hoverPt[1]}
                    stroke="var(--accent)" strokeWidth={2}
                    strokeDasharray="8 8" opacity={0.5}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {/* snap-to-close preview line */}
                {snapFirst && draftPts.length >= 3 && (
                  <line
                    x1={draftPts[draftPts.length - 1][0]} y1={draftPts[draftPts.length - 1][1]}
                    x2={draftPts[0][0]} y2={draftPts[0][1]}
                    stroke="rgba(40,200,130,0.85)" strokeWidth={2.5}
                    strokeDasharray="8 6"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {/* draft points */}
                {draftPts.map((p, i) => {
                  const isFirst   = i === 0
                  const snapping  = isFirst && snapFirst && draftPts.length >= 3
                  return (
                    <circle key={i}
                      cx={p[0]} cy={p[1]}
                      r={snapping ? snapRadius : (isFirst ? ptRadius * 1.4 : ptRadius)}
                      fill={isFirst ? 'var(--accent)' : '#fff'}
                      stroke={snapping ? 'rgba(40,200,130,0.9)' : 'var(--accent)'}
                      strokeWidth={snapping ? 3.5 : 2.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                })}
              </g>
            )}
          </svg>

          {/* Status bar */}
          <div className="absolute bottom-0 left-0 right-0 px-3.5 py-2 bg-ink/70 backdrop-blur-sm text-[12px] text-white/90 flex items-center gap-2">
            {mode === 'draw'
              ? draftPts.length === 0
                ? t('setup.roi_hint_start')
                : draftPts.length < 3
                  ? `${draftPts.length} ${t('setup.point')} — ${t('setup.roi_hint_continue')}`
                  : snapFirst
                    ? <span className="text-ok font-semibold">{t('setup.roi_hint_close')}</span>
                    : `${draftPts.length} ${t('setup.point')} — ${t('setup.roi_hint_close')}`
              : selected
                ? t('setup.roi_hint_selected')
                : t('setup.roi_hint_select')}
          </div>
        </div>

        {/* ── Zone panel ────────────────────────────────────────────────────── */}
        <div className="border border-line rounded-md bg-surface flex flex-col overflow-hidden"
          style={{ maxHeight: 'calc(100vw * 9/16 * 0.9)' }}>
          <div className="flex items-center justify-between px-3.5 py-3 border-b border-line flex-shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              {t('setup.zones_title')} · {zones.length}
            </span>
            {isAdmin && (
              <Button size="sm" variant="outline"
                onClick={() => { setMode('draw'); setDraftPts([]); toast.info(t('setup.draw_hint_toast')) }}>
                {t('setup.add_zone')}
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2.5">
            {zones.length === 0 ? (
              <div className="text-[12.5px] text-ink-4 py-6 text-center">
                {t('setup.no_zones')}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {zones.map((z) => (
                  <ZoneCard
                    key={z._id}
                    zone={z}
                    selected={selected === z._id}
                    isAdmin={isAdmin}
                    t={t}
                    onSelect={() => { setSelected(z._id); setMode('select') }}
                    onToggleExpand={() => toggleExpand(z._id)}
                    onChange={(patch) => updateZone(z._id, patch)}
                    onDelete={() => deleteZone(z._id)}
                    onTogglePerspective={() => togglePerspective(z)}
                    onPreview={() => setPreview({ z, snapshotUrl })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Naming dialog ─────────────────────────────────────────────────────── */}
      {naming && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(10,15,25,0.5)' }}
          onClick={() => { setNaming(null); setDraftPts([]) }}>
          <div className="w-[320px] bg-surface rounded-lg shadow-xl p-5 border border-line"
            onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-bold mb-3.5">{t('setup.name_this_zone')}</div>
            <Input
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              placeholder="entrance, cabinet…"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && nameVal) confirmName() }}
            />
            <div className="mt-3 mb-4">
              <div className="inline-flex p-[3px] gap-px bg-bg-2 rounded-sm border border-line">
                {['include', 'exclude'].map((v) => (
                  <button key={v} onClick={() => setNameType(v)}
                    className={`h-7 px-3 rounded-[2px] text-xs font-semibold transition cursor-pointer border-none ${
                      nameType === v ? 'bg-surface shadow-xs text-ink' : 'bg-transparent text-ink-3'
                    }`}>
                    {v === 'include' ? t('setup.include') : t('setup.exclude')}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm"
                onClick={() => { setNaming(null); setDraftPts([]) }}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" disabled={!nameVal} onClick={confirmName}>
                {t('setup.add_zone')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview modal ──────────────────────────────────────────────────────── */}
      {preview && (
        <PreviewModal
          zone={preview.z}
          snapshotUrl={preview.snapshotUrl}
          onClose={() => setPreview(null)}
          t={t}
        />
      )}
    </div>
  )
}

// ── ZoneCard ──────────────────────────────────────────────────────────────────
function ZoneCard({ zone: z, selected, isAdmin, t, onSelect, onToggleExpand, onChange, onDelete, onTogglePerspective, onPreview }) {
  const [editingName, setEditingName] = useState(false)
  const [confirmDel, setConfirmDel]   = useState(false)

  return (
    <div className="border rounded-sm overflow-hidden transition-colors"
      style={{ borderColor: selected ? 'var(--accent)' : 'var(--line)' }}>

      {/* Header row */}
      <div
        className="flex items-center gap-2 px-2.5 py-2 cursor-pointer select-none"
        style={{ background: selected ? 'var(--accent-soft)' : 'var(--bg-2)' }}
        onClick={() => { onSelect(); onToggleExpand() }}
      >
        <span className="text-ink-4 flex-shrink-0">
          {z.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        {/* Name — double-click to rename */}
        {editingName ? (
          <input
            autoFocus value={z.name}
            className="flex-1 text-[13px] font-semibold bg-transparent border-none outline-none text-ink"
            onChange={(e) => onChange({ name: e.target.value })}
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingName(false) }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 text-[13px] font-semibold text-ink-1 truncate"
            onDoubleClick={(e) => { e.stopPropagation(); if (isAdmin) setEditingName(true) }}
            title="Double-click to rename"
          >
            {z.name}
          </span>
        )}

        {/* include/exclude pill — click to toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); if (isAdmin) onChange({ exclude: !z.exclude }) }}
          className="border-0 bg-transparent cursor-pointer p-0 flex-shrink-0"
        >
          <span className="inline-flex items-center px-2 py-[2px] rounded-pill text-[10.5px] font-semibold border"
            style={{
              background:  z.exclude ? 'var(--sev-alarm-bg)' : 'var(--sev-ok-bg)',
              borderColor: z.exclude ? 'var(--sev-alarm)'    : 'var(--sev-ok)',
              color:       z.exclude ? 'var(--sev-alarm)'    : 'var(--sev-ok)',
            }}>
            {z.exclude ? t('setup.exclude') : t('setup.include')}
          </span>
        </button>
      </div>

      {/* Expanded body */}
      {z.expanded && (
        <div className="px-2.5 pb-2.5 pt-2 flex flex-col gap-2.5 bg-surface"
          onClick={(e) => e.stopPropagation()}>

          <div>
            <div className="flex justify-between text-[11.5px] text-ink-3 mb-1">
              <span>{t('setup.rotation')}</span>
              <span className="font-mono">{z.rotation > 0 ? '+' : ''}{z.rotation}°</span>
            </div>
            <input type="range" min={-45} max={45} step={1}
              value={z.rotation ?? 0}
              disabled={!isAdmin}
              onChange={(e) => onChange({ rotation: parseInt(e.target.value) })}
              className="w-full accent-accent"
            />
          </div>

          <label className="flex items-center gap-2 text-[12.5px] text-ink-2 cursor-pointer">
            <input type="checkbox"
              checked={!!z.perspective_quad}
              disabled={!isAdmin}
              onChange={() => onTogglePerspective()}
              className="accent-accent"
            />
            {t('setup.perspective_quad')}
          </label>

          <div className="text-[11.5px] text-ink-4">
            {t('setup.points', { count: z.polygon.length })}
          </div>

          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="flex-1 gap-1 h-7 text-xs" onClick={onPreview}>
              <Eye size={13} />{t('setup.preview')}
            </Button>
            {isAdmin && (
              confirmDel ? (
                <>
                  <Button size="sm" variant="ghost" className="h-7 text-xs px-2"
                    onClick={() => setConfirmDel(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button size="sm" className="h-7 text-xs px-2 bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => { onDelete(); setConfirmDel(false) }}>
                    {t('setup.delete')}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost"
                  className="h-7 text-xs px-2 text-red-500 hover:text-red-500 hover:bg-red-500/10"
                  onClick={() => setConfirmDel(true)}>
                  {t('setup.delete')}
                </Button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── PreviewModal ───────────────────────────────────────────────────────────────
function PreviewModal({ zone: z, snapshotUrl, onClose, t }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cx = centroid(z.polygon)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-8"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}>
      <div className="max-w-[900px] w-full rounded-lg overflow-hidden shadow-2xl border border-white/10"
        onClick={(e) => e.stopPropagation()}>

        {/* Image + SVG overlay — both 16:9 via aspectRatio */}
        <div className="relative bg-[#0f172a]" style={{ aspectRatio: '16/9' }}>
          {snapshotUrl && (
            <img src={snapshotUrl} alt=""
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              draggable={false}
            />
          )}
          {/* SVG uses same viewBox → zones align exactly with the snapshot */}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {!snapshotUrl && <rect width={W} height={H} fill="#0f172a" />}
            <polygon
              points={ptsStr(z.polygon)}
              fill={z.exclude ? 'rgba(255,80,80,0.25)' : 'rgba(40,200,130,0.25)'}
              stroke={z.exclude ? 'rgba(255,80,80,0.9)' : 'rgba(40,200,130,0.9)'}
              strokeWidth={4}
              vectorEffect="non-scaling-stroke"
            />
            {z.perspective_quad && (
              <polygon
                points={ptsStr(z.perspective_quad)}
                fill="none"
                stroke="rgba(255,255,100,0.7)"
                strokeWidth={2} strokeDasharray="14 8"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <text
              x={cx[0]} y={cx[1]}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={60} fontWeight="700" fill="#fff"
              style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.7)', strokeWidth: 16 }}
            >
              {z.name}
            </text>
          </svg>

          {/* Top bar overlay */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}>
            <div className="text-white text-[13px] font-semibold">
              {z.name}
              <span className="font-normal opacity-60 ml-2">
                — {z.exclude ? t('setup.exclude') : t('setup.include')} · {t('setup.points', { count: z.polygon.length })}
              </span>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white transition cursor-pointer">
              <X size={20} />
            </button>
          </div>

          {!snapshotUrl && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/25">
              <Camera size={40} strokeWidth={1.25} />
              <span className="text-[13px]">{t('setup.no_snapshot')}</span>
            </div>
          )}
        </div>

        <div className="bg-surface border-t border-line px-4 py-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('setup.close_esc')}
          </Button>
        </div>
      </div>
    </div>
  )
}
