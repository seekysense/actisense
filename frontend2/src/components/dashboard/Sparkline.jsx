import { useMemo } from 'react'
import { parseEventHour } from '@/lib/utils'

const SEV_COLOR = {
  alarm: 'var(--sev-alarm)',
  notify: 'var(--sev-notify)',
  statistic: 'var(--sev-statistic)',
  ok: 'var(--sev-ok)',
}

function severityRank(action) {
  return action === 'alarm' ? 3 : action === 'notify' ? 2 : 1
}

export default function Sparkline({ events, range }) {
  const { b, sev } = useMemo(() => {
    const b = Array.from({ length: 24 }, () => 0)
    const sev = Array.from({ length: 24 }, () => 0)
    events.forEach((e) => {
      const { hour } = parseEventHour(e.timestamp)
      b[hour]++
      sev[hour] = Math.max(sev[hour], severityRank(e.action))
    })
    return { b, sev }
  }, [events])

  const max = Math.max(1, ...b)
  const sevName = [null, 'statistic', 'notify', 'alarm']

  return (
    <div className="flex items-end gap-[3px] h-[30px]">
      {b.map((c, h) => {
        const within = h + 0.5 >= range.from && h + 0.5 < range.to
        const sn = c === 0 ? null : sevName[sev[h]]
        return (
          <div
            key={h}
            className="flex-1 rounded-[1px] transition-opacity duration-150"
            style={{
              height: c === 0 ? 2 : Math.max(3, (c / max) * 30),
              background: c === 0 ? 'var(--line)' : SEV_COLOR[sn],
              opacity: within ? 1 : 0.28,
            }}
          />
        )
      })}
    </div>
  )
}
