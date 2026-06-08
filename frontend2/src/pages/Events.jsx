import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarX, ChevronLeft, ChevronRight, Search, AlertTriangle } from 'lucide-react'
import { useConfig } from '@/hooks/useConfig'
import { useEvents } from '@/hooks/useEvents'
import { useSmartSearchStore } from '@/stores/smartSearchStore'
import { formatTime } from '@/lib/utils'
import ActionPill from '@/components/iqframe/ActionPill'
import PriorityChip from '@/components/iqframe/PriorityChip'
import EmptyState from '@/components/iqframe/EmptyState'
import EventDrawer from '@/components/dashboard/EventDrawer'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DatePickerPopover from '@/components/iqframe/DatePickerPopover'

function shiftDate(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function formatDateLabel(dateStr, lang) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(
    lang === 'it' ? 'it-IT' : 'en-US',
    { weekday: 'short', day: 'numeric', month: 'short' }
  )
}

function FilterPill({ label }) {
  return (
    <span className="inline-flex items-center px-2.5 py-[3px] rounded-full text-[11px] font-medium bg-accent/10 text-accent border border-accent/20 whitespace-nowrap">
      {label}
    </span>
  )
}

function SmartBanner({ query, filters, confidence, onClear, t }) {
  const pills = []

  if (filters.area_id) pills.push(t('events.filter_pill_area', { val: filters.area_id }))
  if (filters.signal_id) pills.push(t('events.filter_pill_signal', { val: filters.signal_id }))
  if (filters.action) pills.push(t('events.filter_pill_action', { val: filters.action }))
  if (filters.camera_id) pills.push(t('events.filter_pill_camera', { val: filters.camera_id }))
  if (filters.score_above != null) pills.push(t('events.filter_pill_score_above', { val: filters.score_above }))
  if (filters.score_below != null) pills.push(t('events.filter_pill_score_below', { val: filters.score_below }))
  if (filters.date_from) {
    if (filters.date_to && filters.date_to !== filters.date_from) {
      pills.push(t('events.filter_pill_date_range', { from: filters.date_from, to: filters.date_to }))
    } else {
      pills.push(t('events.filter_pill_date_single', { from: filters.date_from }))
    }
  }

  return (
    <div className="mb-4 rounded-md border border-accent/20 bg-accent/5 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Search size={14} className="text-accent flex-shrink-0" />
        <span className="text-[12.5px] font-semibold text-accent">{t('events.smart_search_active')}</span>
        {query && (
          <span className="text-[12px] text-ink-2 italic truncate max-w-[260px]">"{query}"</span>
        )}
        <div className="flex-1" />
        <button
          onClick={onClear}
          className="text-[11.5px] text-ink-3 hover:text-ink-1 transition cursor-pointer underline underline-offset-2 flex-shrink-0"
        >
          {t('events.smart_search_clear')}
        </button>
      </div>

      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pills.map((p) => <FilterPill key={p} label={p} />)}
        </div>
      )}

      {confidence === 'low' && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-amber-600">
          <AlertTriangle size={13} />
          {t('events.smart_search_approx')}
        </div>
      )}
    </div>
  )
}

export default function Events() {
  const { t, i18n } = useTranslation()
  const today = new Date().toISOString().slice(0, 10)

  const { data: config, isLoading: configLoading } = useConfig()

  // Smart search store
  const isActive = useSmartSearchStore((s) => s.isActive)
  const smartResults = useSmartSearchStore((s) => s.results)
  const smartFilters = useSmartSearchStore((s) => s.filters)
  const smartQuery = useSmartSearchStore((s) => s.query)
  const confidence = useSmartSearchStore((s) => s.confidence)
  const clearResults = useSmartSearchStore((s) => s.clearResults)

  // Date navigator (hidden when smart search active)
  const [selectedDate, setSelectedDate] = useState(today)

  // Always call the hook unconditionally; ignore its data when isActive
  const { data: eventsData, isLoading: eventsLoading } = useEvents({ date: selectedDate })

  // Local filters
  const [actionFilter, setActionFilter] = useState('all')
  const [areaFilter, setAreaFilter] = useState('all')

  // Drawer: track index in the visible array (null = closed)
  const [selectedIndex, setSelectedIndex] = useState(null)

  const areas = config?.areas || []
  const rawEvents = isActive ? smartResults : (eventsData?.events || [])

  const filtered = useMemo(() => {
    return rawEvents.filter((e) => {
      if (actionFilter !== 'all' && e.action !== actionFilter) return false
      if (areaFilter !== 'all' && e.area_id !== areaFilter) return false
      return true
    })
  }, [rawEvents, actionFilter, areaFilter])

  const visible = filtered.slice(0, 200)

  // Drawer state derived from index
  const selectedEvent = selectedIndex != null ? visible[selectedIndex] ?? null : null

  const isLoading = !isActive && (configLoading || eventsLoading)

  // Date label for subtitle
  const dateFmt = formatDateLabel(selectedDate, i18n.language)

  function openEvent(idx) {
    setSelectedIndex(idx)
  }

  function closeDrawer() {
    setSelectedIndex(null)
  }

  function handlePrev() {
    setSelectedIndex((i) => (i != null && i > 0 ? i - 1 : i))
  }

  function handleNext() {
    setSelectedIndex((i) => (i != null && i < visible.length - 1 ? i + 1 : i))
  }

  // When "Altri eventi" inside the drawer is clicked, find the event in the visible list
  function handleOpenEvent(ev) {
    const idx = visible.findIndex((e) => e.event_id === ev.event_id)
    if (idx !== -1) setSelectedIndex(idx)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      {/* Overlay when drawer open */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-black/30 z-[129]"
          onClick={closeDrawer}
        />
      )}

      {/* Drawer */}
      {selectedEvent && (
        <EventDrawer
          event={selectedEvent}
          siblings={visible}
          onClose={closeDrawer}
          onOpenEvent={handleOpenEvent}
          currentIndex={selectedIndex + 1}
          totalCount={visible.length}
          onPrev={handlePrev}
          onNext={handleNext}
        />
      )}

      {/* Page header */}
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[27px] font-bold tracking-tight text-ink">{t('events.title')}</h1>
          <p className="text-sm text-ink-3 mt-1">
            {isActive
              ? t('events.subtitle_smart', { count: filtered.length, query: smartQuery })
              : t('events.subtitle', { count: filtered.length, date: dateFmt })}
          </p>
        </div>

        {/* Date navigator — hidden when smart search active */}
        {!isActive && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center border border-line rounded-sm overflow-hidden bg-surface h-8">
              <button
                onClick={() => setSelectedDate((d) => shiftDate(d, -1))}
                className="h-full w-8 flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink transition cursor-pointer"
              >
                <ChevronLeft size={15} />
              </button>
              <DatePickerPopover value={selectedDate} onChange={setSelectedDate} align="right">
                <span className="h-8 px-3 flex items-center text-[12.5px] font-semibold text-ink border-x border-line whitespace-nowrap cursor-pointer hover:bg-bg-2 transition select-none">
                  {formatDateLabel(selectedDate, i18n.language)}
                </span>
              </DatePickerPopover>
              <button
                onClick={() => setSelectedDate((d) => shiftDate(d, 1))}
                disabled={selectedDate >= today}
                className="h-full w-8 flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink transition cursor-pointer disabled:opacity-30 disabled:cursor-default"
              >
                <ChevronRight size={15} />
              </button>
            </div>
            {selectedDate !== today && (
              <button
                onClick={() => setSelectedDate(today)}
                className="h-8 px-3 text-[12.5px] font-semibold text-ink-2 border border-line rounded-sm bg-surface hover:bg-bg-2 transition cursor-pointer whitespace-nowrap"
              >
                {t('events.today_btn')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Smart search banner */}
      {isActive && (
        <SmartBanner
          query={smartQuery}
          filters={smartFilters}
          confidence={confidence}
          onClear={clearResults}
          t={t}
        />
      )}

      {/* Local filters */}
      <div className="flex gap-2.5 mb-4 flex-wrap">
        <Select value={areaFilter} onValueChange={setAreaFilter}>
          <SelectTrigger className="w-[200px] h-9 text-xs">
            <SelectValue placeholder={t('events.filter_area')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('events.filter_area')}</SelectItem>
            {areas.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[170px] h-9 text-xs">
            <SelectValue placeholder={t('events.filter_action')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('events.filter_action')}</SelectItem>
            <SelectItem value="alarm">{t('events.filter_alarm')}</SelectItem>
            <SelectItem value="notify">{t('events.filter_notify')}</SelectItem>
            <SelectItem value="statistic">{t('events.filter_statistic')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border border-line rounded-md overflow-hidden bg-surface">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line">
              {[
                t('events.col_time'),
                t('events.col_area'),
                t('events.col_signal'),
                t('events.col_camera'),
                t('events.col_score'),
                t('events.col_action'),
                t('events.col_priority'),
              ].map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3 ${
                    i === 4 ? 'text-right' : 'text-left'
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((e, i) => (
              <tr
                key={e.event_id || i}
                onClick={() => openEvent(i)}
                className={`border-b border-line last:border-b-0 cursor-pointer transition ${
                  selectedIndex === i ? 'bg-accent/5' : 'hover:bg-bg-2'
                }`}
              >
                <td className="px-4 py-2.5 font-mono text-[12.5px] text-ink-2 font-semibold">
                  {formatTime(new Date(e.timestamp), {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </td>
                <td className="px-4 py-2.5 text-[13px] text-ink-1">
                  {e.area_name || e.area_id}
                </td>
                <td className="px-4 py-2.5 text-[13px] text-ink-1 font-medium">
                  {e.signal_name || e.signal_id}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-ink-3">
                  {e.camera_id}
                </td>
                <td className="px-4 py-2.5 font-mono text-[12.5px] text-ink-1 text-right">
                  {e.score?.toFixed(3)}
                </td>
                <td className="px-4 py-2.5">
                  <ActionPill action={e.action} />
                </td>
                <td className="px-4 py-2.5">
                  <PriorityChip p={e.priority} active />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <EmptyState
            icon={CalendarX}
            title={t('events.empty_title')}
            hint={t('events.empty_hint')}
          />
        )}
      </div>
    </div>
  )
}
