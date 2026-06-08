import { useTranslation } from 'react-i18next'
import { useConfig } from '@/hooks/useConfig'
import { FileText, Building2 } from 'lucide-react'
import SevCard from '@/components/iqframe/SevCard'
import ActionPill from '@/components/iqframe/ActionPill'
import PriorityChip from '@/components/iqframe/PriorityChip'
import StatusDot from '@/components/iqframe/StatusDot'
import EmptyState from '@/components/iqframe/EmptyState'

export default function Config() {
  const { t } = useTranslation()
  const { data: config, isLoading } = useConfig()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  const site = config?.site || {}
  const areas = config?.areas || []
  const signals = config?.signals || []
  const cameras = config?.cameras || []

  // Count signals per area from area.signals
  const areaSignalCounts = {}
  areas.forEach((a) => {
    areaSignalCounts[a.id] = (a.signals || []).length
  })

  return (
    <div>
      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-[27px] font-bold tracking-tight text-ink">{t('config.title')}</h1>
        <p className="text-sm text-ink-3 mt-1">{t('config.subtitle')}</p>
      </div>

      {/* Site card */}
      <SevCard className="p-5 mb-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-md bg-accent-soft flex items-center justify-center flex-shrink-0">
          <Building2 size={26} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[17px] font-bold tracking-tight">{site.name || 'IQFrame'}</div>
          <div className="text-[12.5px] text-ink-3 mt-0.5">
            <span className="font-mono">{site.id || '-'}</span> · {site.type || '-'} · cooldown{' '}
            <span className="font-mono">{site.alert_cooldown_sec || 300}s</span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-pill text-[11px] font-semibold border bg-ok-bg border-ok/20 text-ok">
          <StatusDot sev="ok" size={5} />
          {t('config.active')}
        </span>
      </SevCard>

      {/* Areas grid */}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-3">
        {t('config.areas')} · {areas.length}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5 mb-7">
        {areas.map((a) => (
          <SevCard key={a.id} className="p-4">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[14.5px] font-bold">{a.name}</span>
              <span className="inline-flex items-center gap-1.5 px-2 py-[2px] rounded-pill text-[10.5px] font-semibold border bg-statistic-bg border-statistic/20 text-statistic">
                {a.type?.replace('_', ' ') || 'area'}
              </span>
            </div>
            <div className="flex gap-[18px]">
              <div>
                <div className="font-mono text-lg font-semibold">{(a.cameras || []).length}</div>
                <div className="text-[10.5px] text-ink-4 uppercase tracking-wider mt-0.5">
                  {t('config.cameras')}
                </div>
              </div>
              <div>
                <div className="font-mono text-lg font-semibold">{areaSignalCounts[a.id] || 0}</div>
                <div className="text-[10.5px] text-ink-4 uppercase tracking-wider mt-0.5">
                  {t('config.signals')}
                </div>
              </div>
            </div>
          </SevCard>
        ))}
      </div>

      {/* Signals grid */}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-3">
        {t('config.signals')} · {signals.length}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
        {signals.map((s) => {
          const sev = s.default_action === 'alarm' ? 'alarm' : s.default_action === 'notify' ? 'notify' : 'statistic'
          return (
            <SevCard key={s.id} sev={sev} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-[12.5px] font-semibold">{s.id}</span>
                <PriorityChip p={s.priority} active />
                <span className="ml-auto">
                  <ActionPill action={s.default_action} dot />
                </span>
              </div>
              <p
                className="text-[12.5px] text-ink-2 italic leading-relaxed mb-2"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                “{s.text || s.semantic_phrase || s.description || ''}”
              </p>
              <div className="text-[11.5px] text-ink-4">
                threshold <span className="font-mono">{(s.default_threshold ?? s.threshold ?? 0).toFixed(2)}</span>
              </div>
            </SevCard>
          )
        })}
      </div>

      {signals.length === 0 && (
        <EmptyState
          icon={FileText}
          title={t('config.no_signals')}
          hint={t('config.no_signals_hint')}
        />
      )}
    </div>
  )
}
