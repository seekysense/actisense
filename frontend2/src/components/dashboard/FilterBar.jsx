import { useTranslation } from 'react-i18next'
import { Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'

function FilterChip({ label, value, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill cursor-pointer whitespace-nowrap transition duration-150 border hover:bg-line"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--line)',
        background: active ? 'var(--accent-soft)' : 'var(--bg-2)',
      }}
    >
      <span className={`text-[12.5px] font-semibold ${active ? 'text-accent-ink' : 'text-ink-1'}`}>{label}</span>
      <span className={`text-[12.5px] ${active ? 'text-accent' : 'text-ink-4'}`}>·</span>
      <span className={`text-[12.5px] font-medium ${active ? 'text-accent-ink' : 'text-ink-3'}`}>{value}</span>
    </button>
  )
}

export default function FilterBar({ filters, areaNames, onOpen }) {
  const { t } = useTranslation()
  const a = filters.areas
  const p = filters.priorities
  const ac = filters.actions

  const areaVal = a.size === 0 ? 'All areas' : a.size === 1 ? (areaNames[[...a][0]] || '1 area') : `${a.size} selected`
  const prioVal = p.size === 0 ? 'All' : [...p].sort((x, y) => x - y).map((n) => 'P' + n).join(', ')
  const actVal = ac.size === 0 ? 'All' : [...ac].map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')

  return (
    <div className="flex items-center gap-2.5 mb-[18px] flex-wrap">
      <FilterChip label={t('dashboard.areas')} value={areaVal} active={a.size > 0} onClick={onOpen} />
      <FilterChip label={t('dashboard.priority')} value={prioVal} active={p.size > 0} onClick={onOpen} />
      <FilterChip label={t('dashboard.action')} value={actVal} active={ac.size > 0} onClick={onOpen} />
      <div className="flex-1" />
      <Button variant="outline" size="sm" className="gap-1.5" onClick={onOpen}>
        <Filter size={16} strokeWidth={1.75} />
        {t('dashboard.filters')}
      </Button>
    </div>
  )
}
