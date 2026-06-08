import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const WEEKDAYS_IT = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do']
const WEEKDAYS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function firstDayOfMonth(year, month) {
  return (new Date(year, month, 1).getDay() + 6) % 7 // Monday-first
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export default function DatePickerPopover({ value, onChange, align = 'right', children }) {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const init = value ? new Date(value + 'T00:00:00') : new Date()
  const [viewYear, setViewYear] = useState(init.getFullYear())
  const [viewMonth, setViewMonth] = useState(init.getMonth())

  const todayStr = new Date().toISOString().slice(0, 10)
  const locale = i18n.language === 'it' ? 'it-IT' : 'en-US'
  const weekdays = i18n.language === 'it' ? WEEKDAYS_IT : WEEKDAYS_EN

  useEffect(() => {
    if (value) {
      const d = new Date(value + 'T00:00:00')
      setViewYear(d.getFullYear())
      setViewMonth(d.getMonth())
    }
  }, [value])

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const keyHandler = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', handler)
    window.addEventListener('keydown', keyHandler)
    return () => {
      window.removeEventListener('mousedown', handler)
      window.removeEventListener('keydown', keyHandler)
    }
  }, [open])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const monthLabel = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString(locale, { month: 'long', year: 'numeric' })

  const offset = firstDayOfMonth(viewYear, viewMonth)
  const count = daysInMonth(viewYear, viewMonth)
  const cells = Array.from({ length: offset }, () => null)
    .concat(Array.from({ length: count }, (_, i) => i + 1))

  function selectDay(d) {
    const ds = toDateStr(viewYear, viewMonth, d)
    onChange(ds)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <div onClick={() => setOpen(o => !o)}>{children}</div>
      {open && (
        <div
          className={`absolute top-[calc(100%+6px)] ${align === 'right' ? 'right-0' : 'left-0'} z-[300] bg-surface border border-line rounded-md shadow-xl p-3 w-[252px] animate-in fade-in duration-150`}
        >
          {/* month nav */}
          <div className="flex items-center justify-between mb-2">
            <button onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-2 text-ink-3 transition cursor-pointer">
              <ChevronLeft size={14} />
            </button>
            <span className="text-[12.5px] font-semibold text-ink capitalize">{monthLabel}</span>
            <button onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-2 text-ink-3 transition cursor-pointer">
              <ChevronRight size={14} />
            </button>
          </div>

          {/* weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {weekdays.map(d => (
              <div key={d} className="text-center text-[10.5px] font-semibold text-ink-4 py-1">{d}</div>
            ))}
          </div>

          {/* day cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((d, i) => {
              if (!d) return <div key={`_${i}`} />
              const ds = toDateStr(viewYear, viewMonth, d)
              const isSelected = ds === value
              const isToday = ds === todayStr
              const isFuture = ds > todayStr
              return (
                <button
                  key={d}
                  onClick={() => !isFuture && selectDay(d)}
                  disabled={isFuture}
                  className={[
                    'h-7 w-full rounded text-[12px] font-medium transition',
                    isFuture ? 'opacity-25 cursor-default' : 'cursor-pointer',
                    isSelected ? 'bg-accent text-white font-semibold' : '',
                    isToday && !isSelected ? 'border border-accent text-accent' : '',
                    !isSelected && !isToday && !isFuture ? 'text-ink-1 hover:bg-bg-2' : '',
                  ].join(' ')}
                >
                  {d}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
