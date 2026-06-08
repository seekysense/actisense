import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronLeft, ChevronRight, ArrowLeft, PlayCircle, Radio } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { parseEventHour, formatTime } from '@/lib/utils'
import ActionPill from '@/components/iqframe/ActionPill'
import EmptyState from '@/components/iqframe/EmptyState'
import { Button } from '@/components/ui/button'

function ClipPlayer({ event, tall }) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const src = event?.event_id ? `/api/clips/${event.event_id}?token=${token}` : null
  return (
    <div
      className="relative w-full rounded-md overflow-hidden flex items-center justify-center"
      style={{ aspectRatio: tall ? '16/10' : '16/9', background: 'linear-gradient(135deg,#1F2937,#111827)' }}
    >
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      {src ? (
        <video
          src={src}
          controls
          className="relative z-[1] w-full h-full object-contain"
          poster=""
        >
          <track kind="captions" />
        </video>
      ) : (
        <div className="relative z-[1] flex flex-col items-center gap-2 text-white/50">
          <PlayCircle size={48} strokeWidth={1.5} />
          <span className="text-xs">{t('dashboard.clip_preview')}</span>
        </div>
      )}
      <div className="absolute top-2.5 left-3 flex items-center gap-1.5 text-white text-[11px] font-mono">
        <span className="w-2 h-2 rounded-full bg-alarm animate-pulse" />
        REC
      </div>
      <div className="absolute top-2.5 right-3 text-white/70 text-[11px] font-mono">{event?.camera_id}</div>
      <div className="absolute bottom-2.5 right-3 text-white/70 text-[11px] font-mono">
        {event?.timestamp ? formatTime(new Date(event.timestamp), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''} UTC
      </div>
    </div>
  )
}

function DrawerHeader({ title, sub, onClose, onBack, pager }) {
  return (
    <div className="px-5 py-4 border-b border-line flex items-center gap-3 flex-shrink-0">
      {onBack && (
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-sm border border-line bg-surface inline-flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink-1 transition cursor-pointer flex-shrink-0"
        >
          <ArrowLeft size={18} />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-bold tracking-tight truncate">{title}</div>
        {sub && <div className="text-xs text-ink-3 mt-0.5">{sub}</div>}
      </div>
      {pager}
      <button
        onClick={onClose}
        className="w-9 h-9 rounded-sm border border-line bg-surface inline-flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink-1 transition cursor-pointer flex-shrink-0"
      >
        <X size={18} />
      </button>
    </div>
  )
}

export default function AreaDrawer({ area, events, range, onClose, onOpenEvent }) {
  const { t } = useTranslation()
  const [sel, setSel] = useState(null)

  const inRange = events.filter((e) => {
    const { hour, min } = parseEventHour(e.timestamp)
    const h = hour + min / 60
    return h >= range.from && h < range.to
  })

  const camCount = area?.cameras?.length || 0

  if (sel != null) {
    const ev = inRange[sel]
    return (
      <div className="fixed top-0 bottom-0 right-0 w-[460px] max-w-[92vw] flex flex-col bg-surface shadow-xl z-[120] animate-in slide-in-from-right duration-240" style={{ animationTimingFunction: 'cubic-bezier(.4,0,.2,1)' }}>
        <DrawerHeader
          title={area?.name}
          sub={t('events.event_detail')}
          onClose={onClose}
          onBack={() => setSel(null)}
          pager={
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSel(Math.max(0, sel - 1))}
                className="w-8 h-8 rounded-sm border border-line bg-surface inline-flex items-center justify-center text-ink-3 hover:bg-bg-2 transition cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="font-mono text-xs text-ink-3 min-w-[48px] text-center">
                {sel + 1} / {inRange.length}
              </span>
              <button
                onClick={() => setSel(Math.min(inRange.length - 1, sel + 1))}
                className="w-8 h-8 rounded-sm border border-line bg-surface inline-flex items-center justify-center text-ink-3 hover:bg-bg-2 transition cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          }
        />
        <div className="flex-1 overflow-y-auto p-5">
          <ClipPlayer event={ev} />
          <div className="flex gap-3.5 mx-0.5 my-3 text-[11.5px] text-ink-3">
            <span className="font-mono">{ev.camera_id}</span>
            <span>·</span>
            <span className="font-mono">{formatTime(new Date(ev.timestamp), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span>·</span>
            <span>1920×1080</span>
          </div>
          <div className="border border-line rounded-md overflow-hidden">
            {[
              { label: t('events.signal'), value: ev.signal_id || ev.signal_name },
              { label: t('events.score'), value: ev.score?.toFixed(3), mono: true },
              { label: 'action', value: null, isAction: true },
              { label: t('events.camera'), value: ev.camera_id, mono: true },
              { label: t('events.priority'), value: `P${ev.priority}` },
            ].map((row, i) => (
              <div
                key={row.label}
                className="flex items-center justify-between px-3.5 py-2.5"
                style={{ borderBottom: i < 4 ? '1px solid var(--line)' : 'none' }}
              >
                <span className="text-[12.5px] text-ink-3">{row.label === 'action' ? t('events.action') : row.label}</span>
                {row.isAction ? (
                  <ActionPill action={ev.action} />
                ) : (
                  <span className={`${row.mono ? 'font-mono' : ''} text-[13px] font-semibold text-ink-1`}>{row.value}</span>
                )}
              </div>
            ))}
          </div>
          {ev.llm_verdict_description && (
            <div className="mt-3.5 p-3.5 bg-accent-soft rounded-md border border-[#DBEAFE]">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Radio size={16} className="text-accent-ink" />
                <span className="text-[11.5px] font-semibold text-accent-ink uppercase tracking-wider">
                  LLM Verdict · {Math.round((ev.llm_verdict_confidence || 0) * 100)}%
                </span>
              </div>
              <p className="text-[13px] text-ink-1 leading-relaxed m-0">{ev.llm_verdict_description}</p>
            </div>
          )}
          <div className="mt-4">
            <Button className="w-full" onClick={() => onOpenEvent && onOpenEvent(ev, inRange)}>
              {t('events.open_full_detail')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed top-0 bottom-0 right-0 w-[460px] max-w-[92vw] flex flex-col bg-surface shadow-xl z-[110] animate-in slide-in-from-right duration-240" style={{ animationTimingFunction: 'cubic-bezier(.4,0,.2,1)' }}>
      <DrawerHeader
        title={area?.name}
        sub={`${camCount} camera${camCount > 1 ? 's' : ''} · ${inRange.length} events in range`}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto">
        {inRange.length === 0 ? (
          <EmptyState
            icon={Radio}
            title={t('dashboard.no_events_range')}
            hint={t('dashboard.no_events_range_hint')}
          />
        ) : (
          <div>
            {inRange.map((ev, i) => {
              const { hour, min } = parseEventHour(ev.timestamp)
              return (
                <button
                  key={ev.event_id || i}
                  onClick={() => setSel(i)}
                  className="flex items-center gap-3 w-full px-5 py-3 border-b border-line bg-transparent cursor-pointer text-left hover:bg-bg-2 transition"
                >
                  <span className="font-mono text-[12.5px] text-ink-2 font-semibold w-[42px]">
                    {String(hour).padStart(2, '0')}:{String(min).padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink-1 truncate">
                      {ev.signal_name || ev.signal_id}
                    </div>
                    <div className="text-[11px] text-ink-4 font-mono mt-0.5">{ev.camera_id}</div>
                  </div>
                  <span className="font-mono text-xs text-ink-3">{ev.score?.toFixed(3)}</span>
                  <ActionPill action={ev.action} />
                  <ChevronRight size={18} className="text-ink-4 flex-shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
