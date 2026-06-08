import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X, CheckCircle, RefreshCw } from 'lucide-react'
import { useLiveStatus } from '@/hooks/useLiveStatus'
import { useWsStore } from '@/stores/wsStore'
import StatusDot from '@/components/iqframe/StatusDot'
import { Button } from '@/components/ui/button'

function DrawerHeader({ title, sub, onClose }) {
  return (
    <div className="px-5 py-4 border-b border-line flex items-center gap-3 flex-shrink-0">
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-bold tracking-tight truncate">{title}</div>
        {sub && <div className="text-xs text-ink-3 mt-0.5">{sub}</div>}
      </div>
      <button
        onClick={onClose}
        className="w-9 h-9 rounded-sm border border-line bg-surface inline-flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink-1 transition cursor-pointer flex-shrink-0"
      >
        <X size={18} />
      </button>
    </div>
  )
}

function relTimeUnix(unix) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function camSev(c) {
  if (!c.reachable) return 'alarm'
  if (c.last_clip_at && Date.now() / 1000 - c.last_clip_at > 300) return 'notify'
  return 'ok'
}

export default function LivePanel({ open, onClose }) {
  const { t } = useTranslation()
  const { data: status } = useLiveStatus()
  const wsEvents = useWsStore((s) => s.engineEvents)
  const [filter, setFilter] = useState('all')

  if (!open) return null

  const q = status?.queue || {
    queue_depth: 0,
    processed_count: 0,
    dropped_count: 0,
    avg_latency_ms: 0,
    workers_busy: 0,
    max_workers: 1,
  }
  const cams = status?.cameras ? Object.values(status.cameras) : []
  const activity = status?.activity || []
  const pendingByArea = status?.pending_summary?.pending_by_area || {}

  const allBusy = q.workers_busy >= q.max_workers

  const acts =
    filter === 'all'
      ? activity
      : activity.filter((a) => a.kind === filter)

  const kindMeta = {
    clip_downloaded: { color: '#94A3B8' },
    clip_ingested: { color: 'var(--accent)' },
    clip_processing: { color: 'var(--accent)' },
    clip_scored: { color: 'var(--accent)' },
    clip_dropped: { color: 'var(--sev-notify)' },
    llm_suppressed: { color: '#475569' },
    clip_error: { color: 'var(--sev-alarm)' },
    action_fired: { color: 'var(--ok)' },
  }

  return (
    <div className="fixed inset-0 z-[140]">
      <div onClick={onClose} className="absolute inset-0 bg-ink/45 animate-in fade-in duration-180" />
      <div
        className="absolute top-0 right-0 h-full w-[440px] max-w-[92vw] bg-surface shadow-xl flex flex-col animate-in slide-in-from-right duration-240"
        style={{ animationTimingFunction: 'cubic-bezier(.4,0,.2,1)' }}
      >
        <DrawerHeader title={t('dashboard.live_monitor')} sub={t('dashboard.live_subtitle')} onClose={onClose} />
        <div className="flex-1 overflow-y-auto p-4">
          {/* summary */}
          <div
            className="px-3.5 py-3 rounded-md border flex items-center gap-2.5 mb-4"
            style={{
              background: allBusy ? 'var(--sev-notify-bg)' : 'var(--sev-ok-bg)',
              borderColor: allBusy ? 'var(--sev-notify)33' : 'var(--sev-ok)33',
            }}
          >
            {q.queue_depth === 0 ? (
              <CheckCircle size={20} className="text-ok" />
            ) : (
              <RefreshCw size={20} className={allBusy ? 'text-notify' : 'text-ok'} />
            )}
            <span className="text-[13px] font-semibold text-ink-1">
              {q.queue_depth === 0
                ? t('dashboard.live_up_to_date')
                : t('dashboard.live_queue_status', {depth: q.queue_depth, busy: q.workers_busy, max: q.max_workers})}
            </span>
          </div>

          {/* pending pills */}
          {Object.keys(pendingByArea).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {Object.entries(pendingByArea).map(([area, n]) => (
                <span
                  key={area}
                  className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-pill text-[11px] font-semibold border"
                  style={{
                    background: 'var(--sev-notify-bg)',
                    borderColor: 'var(--sev-notify)22',
                    color: 'var(--sev-notify)',
                  }}
                >
                  {area}: {n} {t('common.pending')}
                </span>
              ))}
            </div>
          )}

          {/* queue card */}
          <div className="border border-line rounded-md p-3.5 mb-4 bg-surface">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-2.5">{t('dashboard.processing_queue')}</div>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-2 bg-bg-2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(q.workers_busy / q.max_workers) * 100}%`,
                    background: allBusy ? 'var(--sev-alarm)' : 'var(--accent)',
                  }}
                />
              </div>
              <span className="font-mono text-xs text-ink-2 font-semibold">
                {q.workers_busy}/{q.max_workers}
              </span>
            </div>
            <div className="flex gap-3">
              {[
                [t('dashboard.in_queue'), q.queue_depth, 'var(--ink)'],
                [t('dashboard.processed'), q.processed_count, 'var(--ink)'],
                [t('dashboard.dropped'), q.dropped_count, q.dropped_count > 0 ? 'var(--sev-alarm)' : 'var(--ink)'],
              ].map(([l, v, c]) => (
                <div key={l} className="flex-1">
                  <div className="font-mono text-lg font-semibold" style={{ color: c }}>
                    {v}
                  </div>
                  <div className="text-[10.5px] text-ink-4 uppercase tracking-wider mt-0.5">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-2.5 border-t border-line text-[11.5px] text-ink-3">
              {t('dashboard.avg_processing')}{' '}
              <span className="font-mono font-semibold text-ink-2">{(q.avg_latency_ms / 1000).toFixed(1)}s</span>
            </div>
          </div>

          {/* camera status */}
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-2.5">Camera Status</div>
          <div className="flex flex-col gap-1.5 mb-4">
            {cams.map((c) => {
              const sev = camSev(c)
              return (
                <div key={c.camera_id} className="flex items-center gap-2.5 px-2.5 py-2 border border-line rounded-sm">
                  <StatusDot sev={sev} size={8} pulse={sev !== 'ok'} />
                  <span className="font-mono text-xs font-semibold text-ink-1 flex-1">{c.camera_id}</span>
                  <span className="text-[11px] text-ink-4">clip {relTimeUnix(c.last_clip_at || c._ts)}</span>
                  {c.clips_last_hour > 0 && (
                    <span className="font-mono text-[11px] text-ink-3">{c.clips_last_hour}/h</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* activity log */}
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{t('dashboard.activity_log')}</span>
          </div>
          <div className="flex gap-1.5 mb-2.5 flex-wrap">
            {['all', 'clip_ingested', 'clip_processing', 'clip_scored', 'clip_dropped'].map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className="px-2.5 py-1 rounded-pill text-[11px] font-semibold cursor-pointer transition border"
                style={{
                  borderColor: filter === k ? 'var(--accent)' : 'var(--line)',
                  background: filter === k ? 'var(--accent-soft)' : 'var(--surface)',
                  color: filter === k ? 'var(--accent-ink)' : 'var(--ink-3)',
                  fontFamily: k === 'all' ? 'inherit' : 'var(--font-mono)',
                }}
              >
                {k === 'all' ? t('common.all') : k}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-0.5">
            {acts.map((a, i) => {
              const meta = kindMeta[a.kind] || { color: 'var(--ink-3)' }
              return (
                <div key={i} className="flex items-center gap-2 px-2 py-2 rounded-sm hover:bg-bg-2 transition">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: meta.color }}
                  />
                  <span className="font-mono text-[11.5px] text-ink-2 flex-1 truncate">
                    {a.camera_id}
                    {a.signal_id ? ` · ${a.signal_id}` : ''}
                  </span>
                  {a.score != null && (
                    <span className="font-mono text-[11px] text-ink-3">{a.score.toFixed(3)}</span>
                  )}
                  <span className="text-[10.5px] text-ink-4 font-mono">{relTimeUnix(a.ts)}</span>
                </div>
              )
            })}
            {acts.length === 0 && (
              <div className="text-xs text-ink-4 py-2">{t('dashboard.no_activity_filter')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
