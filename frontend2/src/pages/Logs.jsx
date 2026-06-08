import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLogs } from '@/hooks/useLogs'
import { formatTime, relTime } from '@/lib/utils'
import { Inbox, Loader, CheckCircle, XCircle, EyeOff, AlertTriangle, Zap, Terminal } from 'lucide-react'
import EmptyState from '@/components/iqframe/EmptyState'
import ActionPill from '@/components/iqframe/ActionPill'
import { Badge } from '@/components/ui/badge'

const KINDS = [
  'clip_ingested',
  'clip_processing',
  'clip_scored',
  'clip_dropped',
  'llm_suppressed',
  'clip_error',
  'action_fired',
]

const KIND_ICONS = {
  clip_ingested: Inbox,
  clip_processing: Loader,
  clip_scored: CheckCircle,
  clip_dropped: XCircle,
  llm_suppressed: EyeOff,
  clip_error: AlertTriangle,
  action_fired: Zap,
}

const KIND_COLORS = {
  clip_ingested: 'var(--accent)',
  clip_processing: 'var(--sev-notify)',
  clip_scored: 'var(--sev-ok)',
  clip_dropped: 'var(--ink-4)',
  llm_suppressed: 'var(--ink-4)',
  clip_error: 'var(--sev-alarm)',
  action_fired: 'var(--sev-notify)',
}

const KIND_BG = {
  clip_ingested: 'var(--accent-soft)',
  clip_processing: 'var(--sev-notify-bg)',
  clip_scored: 'var(--sev-ok-bg)',
  clip_dropped: 'var(--bg-2)',
  llm_suppressed: 'var(--bg-2)',
  clip_error: 'var(--sev-alarm-bg)',
  action_fired: 'var(--sev-notify-bg)',
}

export default function Logs() {
  const { t } = useTranslation()
  const [kind, setKind] = useState(null)
  const { data, dataUpdatedAt, isLoading } = useLogs(kind)
  const entries = data?.entries || []
  const count = data?.count || 0

  const lastRefresh = dataUpdatedAt ? formatTime(new Date(dataUpdatedAt)) : '--:--:--'

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[27px] font-bold tracking-tight text-ink">{t('nav.logs')}</h1>
          <p className="text-sm text-ink-3 mt-1">
            {t('logs.entries_summary', { count, time: lastRefresh })}
          </p>
        </div>
        <Badge variant="outline" className="text-[11px] h-6">Auto-refresh 10s</Badge>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <button
          onClick={() => setKind(null)}
          className={`h-7 px-3 rounded-pill text-[11.5px] font-semibold border transition cursor-pointer ${
            kind === null
              ? 'bg-accent text-white border-accent'
              : 'bg-surface text-ink-3 border-line hover:text-ink-2'
          }`}
        >
          {t('common.all')}
        </button>
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`h-7 px-3 rounded-pill text-[11.5px] font-semibold border transition cursor-pointer font-mono ${
              kind === k
                ? 'bg-accent text-white border-accent'
                : 'bg-surface text-ink-3 border-line hover:text-ink-2'
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      {isLoading && entries.length === 0 ? (
        <div className="text-sm text-ink-3 py-10">{t('common.loading')}</div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Terminal}
          title={t('logs.no_entries_title')}
          hint={t('logs.no_entries_hint')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e, i) => {
            const ts = e.ts ? new Date(e.ts * 1000) : new Date()
            const Icon = KIND_ICONS[e.kind] || Terminal
            const color = KIND_COLORS[e.kind] || 'var(--ink-4)'
            const bg = KIND_BG[e.kind] || 'var(--bg-2)'
            return (
              <div
                key={i}
                className="flex items-center gap-3 px-3.5 py-2.5 bg-surface border border-line rounded-sm hover:bg-bg-2 transition"
              >
                <div
                  className="w-8 h-8 rounded-sm flex items-center justify-center shrink-0"
                  style={{ background: bg, color }}
                >
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0 grid grid-cols-[90px_1fr_auto] md:grid-cols-[110px_1fr_140px_auto] gap-x-3 gap-y-0.5 items-center">
                  <div className="font-mono text-[11.5px] text-ink-3 truncate">
                    {formatTime(ts)}
                  </div>
                  <div className="text-[13px] text-ink-1 truncate">
                    {e.detail || e.kind}
                  </div>
                  <div className="hidden md:flex items-center gap-2 text-[11.5px] text-ink-3 truncate">
                    {e.camera_id && <span className="font-mono">{e.camera_id}</span>}
                    {e.signal_id && <span className="font-mono">{e.signal_id}</span>}
                    {e.score != null && (
                      <span className="font-mono">{e.score.toFixed(2)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 justify-end">
                    {e.action && <ActionPill action={e.action} soft />}
                    <span className="text-[10.5px] text-ink-4 whitespace-nowrap">
                      {relTime(ts)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
