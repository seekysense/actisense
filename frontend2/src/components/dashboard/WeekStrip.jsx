import { useTranslation } from 'react-i18next'
import { parseEventHour } from '@/lib/utils'

function dayKey(d) {
  return d.toISOString().slice(0, 10)
}

function isTodayFn(d) {
  return dayKey(d) === dayKey(new Date())
}

export default function WeekStrip({ weekDays, activeDate, onPick, range, eventsByDay }) {
  const { t, i18n } = useTranslation()

  return (
    <div className="flex gap-2 mt-1">
      {weekDays.map((d) => {
        const key = dayKey(d)
        const evs = (eventsByDay[key] || []).filter((e) => {
          const { hour, min } = parseEventHour(e.timestamp)
          const h = hour + min / 60
          return h >= range.from && h < range.to
        })
        const isActive = dayKey(activeDate) === key
        const isToday = isTodayFn(d)
        return (
          <button
            key={key}
            onClick={() => onPick(d)}
            className="flex-1 py-2.5 px-2 rounded-md cursor-pointer text-center border-[1.5px] transition"
            style={{
              borderColor: isActive ? 'var(--accent)' : isToday ? 'var(--accent)' : 'var(--line)',
              background: isActive ? 'var(--accent)' : 'var(--surface)',
              color: isActive ? '#fff' : 'var(--ink-1)',
            }}
          >
            <div className="text-[10.5px] font-semibold uppercase tracking-wider opacity-80">
              {d.toLocaleDateString(i18n.language === 'it' ? 'it-IT' : 'en-US', { weekday: 'short' })}
            </div>
            <div className="text-lg font-bold my-[3px]">{d.getDate()}</div>
            <div className="font-mono text-[11px] font-semibold" style={{ color: isActive ? 'rgba(255,255,255,0.85)' : 'var(--ink-3)' }}>
              {evs.length}
            </div>
          </button>
        )
      })}
    </div>
  )
}
