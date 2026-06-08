import { useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { parseEventHour } from '@/lib/utils'
import SevCard from '@/components/iqframe/SevCard'

const HOUR_W = 100 / 24
const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

const SEV_COLOR = {
  alarm: 'var(--sev-alarm)',
  notify: 'var(--sev-notify)',
  statistic: 'var(--sev-statistic)',
}

function fmtHour(h) {
  const hh = Math.floor(h) % 24
  const mm = Math.round((h - Math.floor(h)) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export default function TimeBar({ events, range, setRange, date, isToday }) {
  const { t } = useTranslation()
  const trackRef = useRef(null)
  const drag = useRef(null)

  // hourly buckets
  const { buckets, maxTotal } = useMemo(() => {
    const b = Array.from({ length: 24 }, () => ({ statistic: 0, notify: 0, alarm: 0, total: 0 }))
    events.forEach((e) => {
      const { hour } = parseEventHour(e.timestamp)
      if (hour >= 0 && hour < 24) {
        b[hour][e.action]++
        b[hour].total++
      }
    })
    const maxTotal = Math.max(1, ...b.map((x) => x.total))
    return { buckets: b, maxTotal }
  }, [events])

  const inRange = events.filter((e) => {
    const { hour, min } = parseEventHour(e.timestamp)
    const h = hour + min / 60
    return h >= range.from && h < range.to
  })
  const dur = range.to - range.from

  const fullDate = date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const xToHour = (clientX) => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    let h = ((clientX - rect.left) / rect.width) * 24
    return Math.max(0, Math.min(24, h))
  }

  const onDown = (mode) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { mode, startX: e.clientX, from: range.from, to: range.to }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onMove = (e) => {
    if (!drag.current || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const dh = ((e.clientX - drag.current.startX) / rect.width) * 24
    const { mode, from, to } = drag.current
    const minSpan = 0.5
    if (mode === 'move') {
      let nf = from + dh
      let nt = to + dh
      const span = to - from
      if (nf < 0) {
        nf = 0
        nt = span
      }
      if (nt > 24) {
        nt = 24
        nf = 24 - span
      }
      setRange({ from: nf, to: nt })
    } else if (mode === 'l') {
      let nf = Math.max(0, Math.min(to - minSpan, from + dh))
      setRange({ from: nf, to })
    } else if (mode === 'r') {
      let nt = Math.min(24, Math.max(from + minSpan, to + dh))
      setRange({ from, to: nt })
    }
  }

  const onUp = () => {
    drag.current = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  const onTrackClick = (e) => {
    if (drag.current) return
    const h = xToHour(e.clientX)
    const span = range.to - range.from
    let nf = h - span / 2
    let nt = h + span / 2
    if (nf < 0) {
      nf = 0
      nt = span
    }
    if (nt > 24) {
      nt = 24
      nf = 24 - span
    }
    setRange({ from: nf, to: nt })
  }

  const now = new Date()
  const nowH = now.getHours() + now.getMinutes() / 60

  return (
    <SevCard className="p-4 pb-3 mb-5">
      <div className="flex items-center justify-between mb-3.5">
        <div className="text-xs font-semibold text-ink-2 flex items-center gap-2">
          <Clock size={16} className="text-ink-3" strokeWidth={1.75} />
          {t('dashboard.timeline')} · <span className="text-ink-3 font-medium">{fullDate}</span>
        </div>
        <div className="font-mono text-xs text-ink-2 font-medium">
          {fmtHour(range.from)} → {fmtHour(range.to)} · {dur.toFixed(dur % 1 ? 1 : 0)}h · {inRange.length} events
        </div>
      </div>

      <div className="relative select-none">
        {/* track */}
        <div
          ref={trackRef}
          onClick={onTrackClick}
          className="relative h-14 cursor-crosshair flex items-end gap-[2px]"
        >
          {buckets.map((b, h) => {
            const within = h + 0.5 >= range.from && h + 0.5 < range.to
            const stat = (b.statistic / maxTotal) * 48
            const noti = (b.notify / maxTotal) * 48
            const alar = (b.alarm / maxTotal) * 48
            return (
              <div
                key={h}
                className="flex-1 flex flex-col justify-end h-12 transition-opacity duration-150"
                style={{ opacity: within ? 1 : 0.32 }}
              >
                {alar > 0 && (
                  <div className="rounded-t-[2px]" style={{ height: Math.max(2, alar), background: SEV_COLOR.alarm }} />
                )}
                {noti > 0 && (
                  <div style={{ height: Math.max(2, noti), background: SEV_COLOR.notify }} />
                )}
                {stat > 0 && (
                  <div
                    className="rounded-t-[2px]"
                    style={{
                      height: Math.max(2, stat),
                      background: SEV_COLOR.statistic,
                      borderRadius: alar + noti > 0 ? 0 : '2px 2px 0 0',
                      opacity: 0.55,
                    }}
                  />
                )}
                {b.total === 0 && <div className="h-[2px] bg-line" />}
              </div>
            )
          })}

          {/* selection window */}
          <div
            onMouseDown={onDown('move')}
            className="absolute -top-1 -bottom-1 rounded-[5px] cursor-grab z-[3] border-[1.5px] border-accent"
            style={{
              left: `${range.from * HOUR_W}%`,
              width: `${dur * HOUR_W}%`,
              background: 'rgba(37,99,235,0.10)',
            }}
          >
            <div
              onMouseDown={onDown('l')}
              className="absolute -left-[5px] top-0 bottom-0 w-[10px] cursor-ew-resize"
            >
              <span className="absolute left-[2px] top-1/2 -translate-y-1/2 w-1 h-5 bg-accent rounded-[3px]" />
            </div>
            <div
              onMouseDown={onDown('r')}
              className="absolute -right-[5px] top-0 bottom-0 w-[10px] cursor-ew-resize"
            >
              <span className="absolute right-[2px] top-1/2 -translate-y-1/2 w-1 h-5 bg-accent rounded-[3px]" />
            </div>
          </div>

          {/* now cursor */}
          {isToday && (
            <div
              className="absolute -top-1.5 -bottom-1.5 w-[2px] bg-ok z-[2] pointer-events-none"
              style={{ left: `${nowH * HOUR_W}%` }}
            >
              <span className="absolute -top-1 -left-[3px] w-2 h-2 rounded-full bg-ok" />
            </div>
          )}
        </div>

        {/* ticks */}
        <div className="flex mt-2 relative h-3.5">
          {TICKS.map((h) => (
            <span
              key={h}
              className="absolute font-mono text-[10px] text-ink-4"
              style={{
                left: `${h * HOUR_W}%`,
                transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {String(h % 24).padStart(2, '0')}:00
            </span>
          ))}
        </div>
      </div>

      {/* legend */}
      <div className="flex gap-4 mt-1.5 pt-2.5 border-t border-line">
        {[
          ['alarm', 'Alarm'],
          ['notify', 'Notify'],
          ['statistic', 'Statistic'],
        ].map(([sev, lbl]) => (
          <span key={sev} className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className="w-[9px] h-[9px] rounded-[2px]" style={{ background: SEV_COLOR[sev] }} />
            {lbl}
          </span>
        ))}
      </div>
    </SevCard>
  )
}
