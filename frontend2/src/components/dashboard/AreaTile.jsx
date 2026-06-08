import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Settings } from 'lucide-react'
import { parseEventHour } from '@/lib/utils'
import SevCard from '@/components/iqframe/SevCard'
import Sparkline from './Sparkline'
import StatusDot from '@/components/iqframe/StatusDot'
import ActionPill from '@/components/iqframe/ActionPill'

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

export default function AreaTile({ area, events, range, onOpenArea, onSignalConfig }) {
  const { t } = useTranslation()

  const inRange = events.filter((e) => {
    const { hour, min } = parseEventHour(e.timestamp)
    const h = hour + min / 60
    return h >= range.from && h < range.to
  })

  const alarm = inRange.filter((e) => e.action === 'alarm').length
  const notify = inRange.filter((e) => e.action === 'notify').length
  const stat = inRange.filter((e) => e.action === 'statistic').length

  let sev = 'ok'
  let badge = { sev: 'ok', text: 'Clear' }
  if (alarm > 0) {
    sev = 'alarm'
    badge = { sev: 'alarm', text: `${alarm} alarm${alarm > 1 ? 's' : ''}` }
  } else if (notify > 0) {
    sev = 'notify'
    badge = { sev: 'notify', text: `${notify} notify` }
  } else if (stat > 0) {
    sev = 'statistic'
    badge = { sev: 'statistic', text: 'Normal' }
  }

  // active signals: group by signal_id and count
  const sigCounts = {}
  inRange.forEach((e) => {
    sigCounts[e.signal_id] = (sigCounts[e.signal_id] || 0) + 1
  })
  const activeSignals = Object.entries(sigCounts)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)

  const clips = inRange.filter((e) => e.action !== 'statistic').length

  return (
    <SevCard sev={sev} hover className="p-4 flex flex-col">
      {/* header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => onOpenArea && onOpenArea(area)}
          className="border-0 bg-transparent cursor-pointer flex items-center gap-1.5 p-0 text-ink hover:opacity-80 transition"
        >
          <span className="text-[15.5px] font-bold tracking-tight">{area.name}</span>
          <ArrowUpRight size={15} className="text-ink-4" />
        </button>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-pill text-[11px] font-semibold border"
          style={{
            color: SEV_COLOR[badge.sev],
            background: SEV_BG[badge.sev],
            borderColor: `${SEV_COLOR[badge.sev]}22`,
          }}
        >
          <StatusDot sev={badge.sev} size={6} pulse={badge.sev !== 'ok'} />
          {badge.text}
        </span>
      </div>

      {/* stats */}
      <div className="flex gap-[18px] mb-3.5">
        {[
          [t('dashboard.events_label'), inRange.length, 'var(--ink)'],
          [t('dashboard.notify_label'), notify, notify > 0 ? 'var(--sev-notify)' : 'var(--ink-4)'],
          [t('dashboard.alarm_label'), alarm, alarm > 0 ? 'var(--sev-alarm)' : 'var(--ink-4)'],
        ].map(([lbl, val, col]) => (
          <div key={lbl}>
            <div className="font-mono text-[21px] font-semibold leading-none" style={{ color: col }}>
              {val}
            </div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-4 mt-1">
              {lbl}
            </div>
          </div>
        ))}
      </div>

      {/* sparkline */}
      <Sparkline events={events} range={range} />

      {/* active signals */}
      <div className="mt-3.5 pt-3 border-t border-line">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            {t('dashboard.active_signals')} · {activeSignals.length}
          </span>
          {clips > 0 && (
            <ActionPill action="statistic" dot>
              {t('dashboard.clips_count', {count: clips})}
            </ActionPill>
          )}
        </div>
        {activeSignals.length === 0 ? (
          <div className="text-xs text-ink-4 py-1.5">{t('dashboard.no_events_in_range')}</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {activeSignals.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 px-1.5 py-[5px] rounded-sm hover:bg-bg-2 transition cursor-default"
              >
                <span className="w-[7px] h-[7px] rounded-full bg-ok flex-shrink-0" />
                <span className="flex-1 text-[12.5px] text-ink-1 font-medium truncate">
                  {s.id}
                </span>
                <span className="font-mono text-[11.5px] text-ink-3">{s.count}</span>
                <button
                  onClick={() => onSignalConfig && onSignalConfig(area, s)}
                  className="border-0 bg-transparent cursor-pointer p-0.5 flex text-ink-4 hover:text-ink-2 transition"
                  title={t('dashboard.configure_signal')}
                >
                  <Settings size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </SevCard>
  )
}
