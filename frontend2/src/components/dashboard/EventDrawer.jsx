import { useTranslation } from 'react-i18next'
import { X, Sparkles, Zap, Share2, Ruler, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { parseEventHour, formatTime } from '@/lib/utils'
import ActionPill from '@/components/iqframe/ActionPill'
import PriorityChip from '@/components/iqframe/PriorityChip'
import StatusDot from '@/components/iqframe/StatusDot'
import { Button } from '@/components/ui/button'

function DrawerHeader({ title, sub, onClose, currentIndex, totalCount, onPrev, onNext }) {
  const hasPagination = totalCount != null && totalCount > 0
  return (
    <div className="px-5 py-4 border-b border-line flex items-center gap-3 flex-shrink-0">
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-bold tracking-tight truncate">{title}</div>
        {sub && <div className="text-xs text-ink-3 mt-0.5">{sub}</div>}
      </div>
      {hasPagination && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onPrev}
            disabled={currentIndex <= 1}
            className="w-7 h-7 rounded-sm border border-line bg-surface inline-flex items-center justify-center text-ink-3 hover:bg-bg-2 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[12px] text-ink-3 font-mono w-[52px] text-center select-none">
            {currentIndex} / {totalCount}
          </span>
          <button
            onClick={onNext}
            disabled={currentIndex >= totalCount}
            className="w-7 h-7 rounded-sm border border-line bg-surface inline-flex items-center justify-center text-ink-3 hover:bg-bg-2 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
      <button
        onClick={onClose}
        className="w-9 h-9 rounded-sm border border-line bg-surface inline-flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink-1 transition cursor-pointer flex-shrink-0"
      >
        <X size={18} />
      </button>
    </div>
  )
}

function PipelineStep({ n, title, icon: Icon, children, color }) {
  return (
    <div className="flex-1 border border-line rounded-md p-3.5 bg-surface">
      <div className="flex items-center gap-2 mb-2.5">
        <div
          className="w-[26px] h-[26px] rounded-sm flex items-center justify-center"
          style={{ background: `${color || 'var(--ink-3)'}18` }}
        >
          <Icon size={16} style={{ color: color || 'var(--ink-2)' }} />
        </div>
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
          {n}. {title}
        </div>
      </div>
      {children}
    </div>
  )
}

function ScoreBar({ score, threshold, action }) {
  const passed = score >= threshold
  const color = passed ? (action === 'alarm' ? 'var(--sev-alarm)' : action === 'notify' ? 'var(--sev-notify)' : 'var(--sev-statistic)') : 'var(--ink-4)'
  return (
    <div className="relative h-2 bg-bg-2 rounded-full overflow-visible">
      <div
        className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-300"
        style={{ width: `${Math.min(100, score * 100)}%`, background: color }}
      />
      {threshold != null && (
        <div
          className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-ink-1 rounded-[2px]"
          style={{ left: `${threshold * 100}%` }}
        />
      )}
    </div>
  )
}

function ClipPlayer({ event }) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const src = event?.event_id ? `/api/clips/${event.event_id}?token=${token}` : null
  return (
    <div
      className="relative w-full rounded-md overflow-hidden flex items-center justify-center"
      style={{ aspectRatio: '16/10', background: 'linear-gradient(135deg,#1F2937,#111827)' }}
    >
      {src ? (
        <video src={src} controls className="relative z-[1] w-full h-full object-contain">
          <track kind="captions" />
        </video>
      ) : (
        <div className="relative z-[1] flex flex-col items-center gap-2 text-white/50">
          <Sparkles size={48} strokeWidth={1.5} />
          <span className="text-xs">{t('dashboard.clip_preview')}</span>
        </div>
      )}
    </div>
  )
}

const SEV_COLOR = {
  alarm: 'var(--sev-alarm)',
  notify: 'var(--sev-notify)',
  statistic: 'var(--sev-statistic)',
  ok: 'var(--sev-ok)',
}

const SEV_BG = {
  alarm: 'var(--sev-alarm-bg)',
  notify: 'var(--sev-notify-bg)',
  statistic: 'var(--sev-statistic-bg)',
  ok: 'var(--sev-ok-bg)',
}

function sevOf(action) {
  return action === 'alarm' ? 'alarm' : action === 'notify' ? 'notify' : 'statistic'
}

export default function EventDrawer({ event, siblings, onClose, onOpenEvent, currentIndex, totalCount, onPrev, onNext }) {
  const { t } = useTranslation()

  if (!event) return null

  const threshold = event.threshold ?? event.signal_threshold ?? 0.43
  const passed = (event.score || 0) >= threshold
  const others = (siblings || [])
    .filter((e) => e.event_id !== event.event_id && e.area_id === event.area_id)
    .slice(0, 10)

  return (
    <div className="fixed top-0 bottom-0 right-0 w-[520px] max-w-[92vw] flex flex-col bg-surface shadow-xl z-[130] animate-in slide-in-from-right duration-240" style={{ animationTimingFunction: 'cubic-bezier(.4,0,.2,1)' }}>
      <DrawerHeader
        title={event.signal_name || event.signal_id}
        sub={
          <span>
            {event.area_name || event.area_id} ·{' '}
            {formatTime(new Date(event.timestamp), { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ·{' '}
            <span className="font-mono">{event.event_id}</span>
          </span>
        }
        onClose={onClose}
        currentIndex={currentIndex}
        totalCount={totalCount}
        onPrev={onPrev}
        onNext={onNext}
      />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-2">{t('dashboard.captured_frame')}</div>
        <ClipPlayer event={event} />

        {/* Detection Pipeline */}
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mt-5 mb-2.5">{t('dashboard.detection_pipeline')}</div>
        <div className="flex gap-2.5">
          <PipelineStep n={1} title={t('dashboard.embedder')} icon={Share2} color="var(--accent)">
            <div
              className="font-mono text-[22px] font-semibold mb-2"
              style={{ color: passed ? SEV_COLOR[sevOf(event.action)] : 'var(--ink-4)' }}
            >
              {(event.score || 0).toFixed(3)}
            </div>
            <ScoreBar score={event.score || 0} threshold={threshold} action={event.action} />
            <div className="text-[11px] text-ink-4 mt-1.5">{t('dashboard.cosine_similarity')}</div>
          </PipelineStep>

          <PipelineStep n={2} title={t('dashboard.threshold_label')} icon={Ruler} color="var(--ink-2)">
            <div className="font-mono text-[22px] font-semibold text-ink-1 mb-2">{threshold.toFixed(2)}</div>
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-pill text-[11px] font-semibold border"
              style={{
                background: passed ? 'var(--sev-ok-bg)' : 'var(--sev-statistic-bg)',
                borderColor: passed ? 'var(--sev-ok)' : 'var(--sev-statistic)',
                color: passed ? 'var(--sev-ok)' : 'var(--sev-statistic)',
              }}
            >
              <StatusDot sev={passed ? 'ok' : 'statistic'} size={5} />
              {passed ? t('dashboard.passed') : t('dashboard.below_threshold')}
            </span>
            <div className="text-[11px] text-ink-4 mt-2">{t('dashboard.configured_threshold')}</div>
          </PipelineStep>

          <PipelineStep n={3} title={t('dashboard.action')} icon={Zap} color={SEV_COLOR[sevOf(event.action)]}>
            <div className="mb-2">
              <ActionPill action={event.action} />
            </div>
            <div className="text-xs text-ink-2">
              {t('events.priority')} <span className="font-mono font-semibold">P{event.priority}</span>
            </div>
            <div className="text-[11px] text-ink-4 mt-1.5">{t('dashboard.cooldown', {sec: event.cooldown_sec || 300})}</div>
          </PipelineStep>
        </div>

        {/* LLM Verdict */}
        {event.llm_verdict_description && (
          <>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mt-5 mb-2.5">{t('dashboard.vision_llm_verdict')}</div>
            <div className="border border-[#DBEAFE] bg-accent-soft rounded-md p-4">
              <div className="flex items-center gap-2.5 mb-2.5">
                <div className="w-[34px] h-[34px] rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                  <Sparkles size={18} className="text-white" />
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-ink-1">LLM Analysis</div>
                  <div className="text-[11.5px] text-ink-3">
                    {event.llm_verdict_confirmed ? t('dashboard.confirmed') : t('dashboard.rejected')} ·{' '}
                    {Math.round((event.llm_verdict_confidence || 0) * 100)}% {t('dashboard.confidence')} ·{' '}
                    <span className="font-mono">{event.llm_latency_ms}ms</span>
                  </div>
                </div>
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-pill text-[11px] font-semibold border"
                  style={{
                    background: event.llm_verdict_confirmed ? 'var(--sev-ok-bg)' : 'var(--sev-statistic-bg)',
                    borderColor: event.llm_verdict_confirmed ? 'var(--sev-ok)' : 'var(--sev-statistic)',
                    color: event.llm_verdict_confirmed ? 'var(--sev-ok)' : 'var(--sev-statistic)',
                  }}
                >
                  <StatusDot sev={event.llm_verdict_confirmed ? 'ok' : 'statistic'} size={5} />
                  {event.llm_verdict_confirmed ? t('dashboard.confirmed') : t('dashboard.rejected')}
                </span>
              </div>
              <p className="text-[13px] text-ink-1 leading-relaxed m-0">{event.llm_verdict_description}</p>
            </div>
          </>
        )}

        {/* Other Events */}
        {others.length > 0 && (
          <>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mt-5 mb-2.5">
              {t('dashboard.other_events')} · {event.area_name || event.area_id}
            </div>
            <div className="border border-line rounded-md overflow-hidden">
              {others.map((e, i) => {
                const { hour, min } = parseEventHour(e.timestamp)
                return (
                  <button
                    key={e.event_id || i}
                    onClick={() => onOpenEvent && onOpenEvent(e, siblings)}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 bg-transparent cursor-pointer text-left hover:bg-bg-2 transition"
                    style={{ borderBottom: i < others.length - 1 ? '1px solid var(--line)' : 'none' }}
                  >
                    <span className="font-mono text-xs text-ink-3 w-10">
                      {String(hour).padStart(2, '0')}:{String(min).padStart(2, '0')}
                    </span>
                    <span className="flex-1 text-[12.5px] text-ink-1 font-medium truncate">
                      {e.signal_name || e.signal_id}
                    </span>
                    <span className="font-mono text-[11.5px] text-ink-3">{e.score?.toFixed(3)}</span>
                    <ActionPill action={e.action} />
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
