import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useConfig } from '@/hooks/useConfig'
import { useEvents } from '@/hooks/useEvents'
import { useDashboardStore } from '@/stores/dashboardStore'
import { parseEventHour } from '@/lib/utils'
import DatePickerPopover from '@/components/iqframe/DatePickerPopover'
import TimeBar from '@/components/dashboard/TimeBar'
import AreaTile from '@/components/dashboard/AreaTile'
import FilterBar from '@/components/dashboard/FilterBar'
import FiltersDrawer from '@/components/dashboard/FiltersDrawer'
import WeekStrip from '@/components/dashboard/WeekStrip'
import AreaDrawer from '@/components/dashboard/AreaDrawer'
import EventDrawer from '@/components/dashboard/EventDrawer'
import SignalPopover from '@/components/dashboard/SignalPopover'
import EmptyState from '@/components/iqframe/EmptyState'
import { FilterX } from 'lucide-react'
import { Button } from '@/components/ui/button'

function getWeekDays(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday start
  const monday = new Date(d.setDate(diff))
  const days = []
  for (let i = 0; i < 7; i++) {
    const next = new Date(monday)
    next.setDate(monday.getDate() + i)
    days.push(next)
  }
  return days
}

function isToday(dateStr) {
  return dateStr === new Date().toISOString().slice(0, 10)
}

export default function Dashboard() {
  const { t, i18n } = useTranslation()
  const { data: config, isLoading: configLoading } = useConfig()
  const filters = useDashboardStore((s) => s.filters)
  const setFilters = useDashboardStore((s) => s.toggleFilter)
  const resetFilters = useDashboardStore((s) => s.resetFilters)
  const dateView = useDashboardStore((s) => s.dateView)
  const setDateView = useDashboardStore((s) => s.setDateView)
  const selectedDate = useDashboardStore((s) => s.selectedDate)
  const setSelectedDate = useDashboardStore((s) => s.setSelectedDate)

  const [range, setRange] = useState({ from: 0, to: 24 })
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Drawer state
  const [areaDrawer, setAreaDrawer] = useState({ open: false, area: null, events: [] })
  const [eventDrawer, setEventDrawer] = useState({ open: false, event: null, siblings: [] })
  const [signalPopover, setSignalPopover] = useState({ open: false, signal: null, area: null })

  const { data: eventsData, isLoading: eventsLoading } = useEvents({ date: selectedDate })

  const areas = config?.areas || []
  const signals = config?.signals || []
  const events = eventsData?.events || []

  // Pre-compute eventsByDay for week strip (fetch all 7 days? expensive)
  // For week strip counts, we only need counts per day in range.
  // To avoid 7 parallel queries, we'll compute from a single week query if available,
  // or just show 0 for now and improve later. For now, we'll use the selectedDate events
  // for the active day, and 0 for others (week strip will be simplified).
  // Actually, let's make a week query when in week view.
  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate])
  const weekStart = weekDays[0]
  const weekEnd = weekDays[6]

  // Fetch events for the whole week to populate week strip counts
  const weekStartStr = weekStart.toISOString().slice(0, 10)
  const weekEndStr = weekEnd.toISOString().slice(0, 10)
  const { data: weekEventsData } = useEvents({ dateFrom: weekStartStr, dateTo: weekEndStr })
  const weekEvents = weekEventsData?.events || []
  const eventsByDay = useMemo(() => {
    const map = {}
    weekEvents.forEach((e) => {
      const d = e.timestamp?.slice(0, 10)
      if (!d) return
      if (!map[d]) map[d] = []
      map[d].push(e)
    })
    return map
  }, [weekEvents])

  // Filter events by area/priority/action AND time range
  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (filters.areas.size && !filters.areas.has(e.area_id)) return false
      if (filters.priorities.size && !filters.priorities.has(e.priority)) return false
      if (filters.actions.size && !filters.actions.has(e.action)) return false
      return true
    })
  }, [events, filters])

  // Area counts (for filters sidebar)
  const areaCounts = useMemo(() => {
    const counts = {}
    events.forEach((e) => {
      counts[e.area_id] = (counts[e.area_id] || 0) + 1
    })
    return counts
  }, [events])

  const areaNames = useMemo(() => {
    const map = {}
    areas.forEach((a) => (map[a.id] = a.name))
    return map
  }, [areas])

  const visibleAreas = areas.filter((a) => !filters.areas.size || filters.areas.has(a.id))

  // Title
  const today = new Date().toISOString().slice(0, 10)
  const locale = i18n.language === 'it' ? 'it-IT' : 'en-US'

  let title = ''
  if (dateView === 'day') {
    if (selectedDate === today) {
      title = t('dashboard.title_today')
    } else {
      const d = new Date(selectedDate + 'T00:00:00')
      title = t('dashboard.title_day', {
        date: d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
      })
    }
  } else {
    const s = weekStart.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
    const e = weekEnd.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
    title = t('dashboard.title_week', { start: s, end: e })
  }

  // Compact label shown inside the nav arrows (weekday + day + month short)
  const navLabel = dateView === 'day'
    ? new Date(selectedDate + 'T00:00:00').toLocaleDateString(locale, {
        weekday: 'short', day: 'numeric', month: 'short',
      })
    : `${weekStart.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${weekEnd.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`

  const subtitle = t('dashboard.subtitle', {
    count: filtered.length,
    areas: visibleAreas.length,
  })

  function handlePickDay(d) {
    setSelectedDate(d.toISOString().slice(0, 10))
    setDateView('day')
  }

  // In day view navigate ±1 day; in week view ±7 days
  const shiftDate = useCallback((delta) => {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setDate(d.getDate() + (dateView === 'week' ? delta * 7 : delta))
    setSelectedDate(d.toISOString().slice(0, 10))
  }, [selectedDate, dateView, setSelectedDate])

  const atToday = dateView === 'day'
    ? selectedDate >= today
    : weekEndStr >= today

  if (configLoading || eventsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-5">
        <div className="flex items-start justify-between gap-5 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-[27px] font-bold tracking-tight text-ink">{title}</h1>
            <p className="text-sm text-ink-3 mt-1">{subtitle}</p>
          </div>

          {/* Date navigation + Day/Week switcher */}
          <div className="flex items-center gap-2 flex-shrink-0">

            {/* [‹] [date label] [›] */}
            <div className="flex items-center border border-line rounded-sm overflow-hidden bg-surface h-8">
              <button
                onClick={() => shiftDate(-1)}
                className="h-full w-8 flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink transition cursor-pointer"
                title={dateView === 'week' ? t('dashboard.prev_week') : t('dashboard.prev_day')}
              >
                <ChevronLeft size={15} />
              </button>
              <DatePickerPopover value={selectedDate} onChange={(d) => { setSelectedDate(d); setDateView('day') }} align="right">
                <span className="h-full px-3 flex items-center text-[12.5px] font-semibold text-ink border-x border-line whitespace-nowrap cursor-pointer hover:bg-bg-2 transition select-none">
                  {navLabel}
                </span>
              </DatePickerPopover>
              <button
                onClick={() => shiftDate(1)}
                disabled={atToday}
                className="h-full w-8 flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink transition cursor-pointer disabled:opacity-30 disabled:cursor-default"
                title={dateView === 'week' ? t('dashboard.next_week') : t('dashboard.next_day')}
              >
                <ChevronRight size={15} />
              </button>
            </div>

            {/* Today — always visible when not on today */}
            {!atToday && (
              <button
                onClick={() => setSelectedDate(today)}
                className="h-8 px-3 text-[12.5px] font-semibold text-ink-2 border border-line rounded-sm bg-surface hover:bg-bg-2 transition cursor-pointer whitespace-nowrap"
              >
                {t('dashboard.today')}
              </button>
            )}

            {/* Day / Week view switcher */}
            <div className="flex items-center border border-line rounded-sm overflow-hidden bg-surface h-8">
              <button
                onClick={() => setDateView('day')}
                className={`h-full px-3 text-xs font-semibold transition cursor-pointer ${
                  dateView === 'day' ? 'bg-bg-2 text-ink' : 'text-ink-3 hover:bg-bg-2'
                }`}
              >
                {t('dashboard.view_day')}
              </button>
              <button
                onClick={() => setDateView('week')}
                className={`h-full px-3 text-xs font-semibold transition cursor-pointer border-l border-line ${
                  dateView === 'week' ? 'bg-bg-2 text-ink' : 'text-ink-3 hover:bg-bg-2'
                }`}
              >
                {t('dashboard.view_week')}
              </button>
            </div>
          </div>
        </div>

        {dateView === 'week' && (
          <WeekStrip
            weekDays={weekDays}
            activeDate={new Date(selectedDate + 'T00:00:00')}
            onPick={handlePickDay}
            range={range}
            eventsByDay={eventsByDay}
          />
        )}
      </div>

      <FilterBar
        filters={filters}
        areaNames={areaNames}
        onOpen={() => setFiltersOpen(true)}
      />

      <FiltersDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        setFilters={(updater) => {
          // Our store uses toggleFilter for individual toggles, but FiltersDrawer
          // expects a setFilters that receives a full object. We adapt by
          // resetting then toggling each active value.
          if (typeof updater === 'function') {
            const next = updater(filters)
            // Reset all then re-apply
            resetFilters()
            next.areas.forEach((v) => setFilters('areas', v))
            next.priorities.forEach((v) => setFilters('priorities', v))
            next.actions.forEach((v) => setFilters('actions', v))
          } else {
            resetFilters()
            updater.areas.forEach((v) => setFilters('areas', v))
            updater.priorities.forEach((v) => setFilters('priorities', v))
            updater.actions.forEach((v) => setFilters('actions', v))
          }
        }}
        areas={areas}
        areaCounts={areaCounts}
      />

      {dateView === 'day' && (
        <TimeBar
          events={filtered}
          range={range}
          setRange={setRange}
          date={new Date(selectedDate + 'T00:00:00')}
          isToday={isToday(selectedDate)}
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {visibleAreas.map((a) => (
          <AreaTile
            key={a.id}
            area={a}
            events={filtered.filter((e) => e.area_id === a.id)}
            range={range}
            onOpenArea={(area) =>
              setAreaDrawer({
                open: true,
                area,
                events: filtered.filter((e) => e.area_id === area.id),
              })
            }
            onSignalConfig={(area, signal) =>
              setSignalPopover({ open: true, area, signal })
            }
          />
        ))}
      </div>

      {areaDrawer.open && (
        <AreaDrawer
          area={areaDrawer.area}
          events={areaDrawer.events}
          range={range}
          onClose={() => setAreaDrawer({ open: false, area: null, events: [] })}
          onOpenEvent={(ev, sibs) =>
            setEventDrawer({ open: true, event: ev, siblings: sibs })
          }
        />
      )}

      {eventDrawer.open && (
        <EventDrawer
          event={eventDrawer.event}
          siblings={eventDrawer.siblings}
          onClose={() => setEventDrawer({ open: false, event: null, siblings: [] })}
          onOpenEvent={(ev, sibs) =>
            setEventDrawer({ open: true, event: ev, siblings: sibs })
          }
        />
      )}

      {signalPopover.open && (
        <SignalPopover
          signal={signalPopover.signal}
          area={signalPopover.area}
          open={signalPopover.open}
          onClose={() => setSignalPopover({ open: false, signal: null, area: null })}
        />
      )}

      {visibleAreas.length === 0 && (
        <EmptyState
          icon={FilterX}
          title="No areas match the filters"
          hint="Adjust the area, priority or action filters in the Filters panel."
          action={
            <Button variant="outline" onClick={() => setFiltersOpen(true)}>
              Open filters
            </Button>
          }
        />
      )}
    </div>
  )
}
