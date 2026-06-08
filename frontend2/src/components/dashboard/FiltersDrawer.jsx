import { useTranslation } from 'react-i18next'
import { X, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import PriorityChip from '@/components/iqframe/PriorityChip'
import ActionPill from '@/components/iqframe/ActionPill'

const SEV_COLOR = {
  alarm: 'var(--sev-alarm)',
  notify: 'var(--sev-notify)',
  statistic: 'var(--sev-statistic)',
}

const SEV_BG = {
  alarm: 'var(--sev-alarm-bg)',
  notify: 'var(--sev-notify-bg)',
  statistic: 'var(--sev-statistic-bg)',
}

export default function FiltersDrawer({ open, onClose, filters, setFilters, areas, areaCounts }) {
  const { t } = useTranslation()

  function toggleSet(key, val) {
    setFilters((f) => {
      const next = new Set(f[key])
      next.has(val) ? next.delete(val) : next.add(val)
      return { ...f, [key]: next }
    })
  }

  function clearSet(key) {
    setFilters((f) => ({ ...f, [key]: new Set() }))
  }

  const anyActive = filters.areas.size || filters.priorities.size || filters.actions.size

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100]">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-ink/45 animate-in fade-in duration-180"
      />
      <div
        className="absolute top-0 right-0 h-full w-[420px] max-w-[92vw] bg-surface shadow-xl flex flex-col animate-in slide-in-from-right duration-240"
        style={{ animationTimingFunction: 'cubic-bezier(.4,0,.2,1)' }}
      >
        <div className="px-6 py-5 border-b border-line flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-ink">{t('dashboard.filters')}</h2>
            <p className="text-[13px] text-ink-3 mt-1.5 leading-relaxed">
              {t('dashboard.filters_hint')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-sm border border-line bg-surface inline-flex items-center justify-center text-ink-3 hover:bg-bg-2 hover:text-ink-1 transition cursor-pointer flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
          {/* Areas */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{t('dashboard.areas')}</span>
              {filters.areas.size > 0 && (
                <button onClick={() => clearSet('areas')} className="text-[11px] font-semibold text-accent hover:underline cursor-pointer">
                  {t('common.clear')}
                </button>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              {areas.map((a) => {
                const sel = filters.areas.has(a.id)
                const cnt = areaCounts[a.id] || 0
                return (
                  <button
                    key={a.id}
                    onClick={() => toggleSet('areas', a.id)}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-sm cursor-pointer text-left w-full transition"
                    style={{
                      background: sel ? 'var(--accent-soft)' : 'transparent',
                      border: `1px solid ${sel ? 'var(--accent)' : 'transparent'}`,
                    }}
                  >
                    {sel ? (
                      <CheckSquare size={18} className="text-accent flex-shrink-0" />
                    ) : (
                      <Square size={18} className="text-ink-4 flex-shrink-0" />
                    )}
                    <span className={`flex-1 text-[13px] ${sel ? 'font-semibold text-accent-ink' : 'font-medium text-ink-1'}`}>
                      {a.name}
                    </span>
                    <span className="font-mono text-xs text-ink-3 font-medium">{cnt}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Priority */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{t('dashboard.priority')}</span>
              {filters.priorities.size > 0 && (
                <button onClick={() => clearSet('priorities')} className="text-[11px] font-semibold text-accent hover:underline cursor-pointer">
                  {t('common.clear')}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-[7px]">
              {[1, 2, 3, 4, 5].map((p) => (
                <PriorityChip
                  key={p}
                  p={p}
                  interactive
                  active={filters.priorities.has(p)}
                  onClick={() => toggleSet('priorities', p)}
                />
              ))}
            </div>
          </div>

          {/* Action */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{t('dashboard.action')}</span>
              {filters.actions.size > 0 && (
                <button onClick={() => clearSet('actions')} className="text-[11px] font-semibold text-accent hover:underline cursor-pointer">
                  {t('common.clear')}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-[7px]">
              {['alarm', 'notify', 'statistic'].map((action) => {
                const sel = filters.actions.has(action)
                return (
                  <button
                    key={action}
                    onClick={() => toggleSet('actions', action)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold cursor-pointer capitalize transition border"
                    style={{
                      borderColor: sel ? SEV_COLOR[action] : 'var(--line)',
                      background: sel ? SEV_BG[action] : 'var(--surface)',
                      color: sel ? SEV_COLOR[action] : 'var(--ink-3)',
                    }}
                  >
                    <span className="w-[7px] h-[7px] rounded-full" style={{ background: SEV_COLOR[action] }} />
                    {action}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-line px-6 py-3.5 flex items-center justify-between flex-shrink-0">
          <Button
            variant="outline"
            onClick={() => setFilters({ areas: new Set(), priorities: new Set(), actions: new Set() })}
            disabled={!anyActive}
          >
            {t('common.reset')}
          </Button>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </div>
  )
}
