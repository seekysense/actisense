import { useTranslation } from 'react-i18next'
import { Pencil, Copy } from 'lucide-react'
import PriorityChip from '@/components/iqframe/PriorityChip'
import ActionPill from '@/components/iqframe/ActionPill'
import ConfirmDelete from '@/components/iqframe/ConfirmDelete'

const ACTION_DOT = {
  alarm: '#EF4444',
  notify: '#F97316',
  statistic: '#94A3B8',
}

export default function SignalRowCard({ signal, onEdit, onClone, onDelete, isAdmin }) {
  const { t } = useTranslation()
  const s = signal

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface border border-line rounded-md hover:border-line-2 transition">
      {/* Dot */}
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ background: ACTION_DOT[s.default_action] || ACTION_DOT.statistic }}
      />

      {/* ID + Name + Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[12.5px] font-semibold text-ink-1">{s.id}</span>
          {s.name && s.name !== s.id && (
            <span className="text-[13px] font-semibold text-ink-1">{s.name}</span>
          )}
          <PriorityChip p={s.priority || 3} active />
          <ActionPill action={s.default_action} dot />
          {s.source === 'native_axis' && (
            <span className="inline-flex items-center px-2 py-[2px] rounded-pill text-[10px] font-semibold border bg-bg-2 border-line text-ink-3">
              {t('setup.native_axis')}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12.5px] text-ink-3 italic truncate max-w-[620px]">
          “{s.text || ''}”
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-ink-4">
          <span className="font-mono">thr {(s.default_threshold ?? 0).toFixed(2)}</span>
          {(s.zone?.length || 0) > 0 && (
            <span>zones: {s.zone.length}</span>
          )}
          {s.escalation_llm && (
            <span className="text-accent">LLM ✓</span>
          )}
          {s.webhook && (
            <span>webhook</span>
          )}
        </div>
      </div>

      {/* Actions */}
      {isAdmin && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onEdit}
            title={t('setup.edit')}
            className="inline-flex items-center justify-center w-[34px] h-[34px] rounded-sm border border-line bg-surface text-ink-3 cursor-pointer transition hover:bg-bg-2 hover:text-ink-1"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={onClone}
            title={t('setup.clone') || 'Clone'}
            className="inline-flex items-center justify-center w-[34px] h-[34px] rounded-sm border border-line bg-surface text-ink-3 cursor-pointer transition hover:bg-bg-2 hover:text-ink-1"
          >
            <Copy size={16} />
          </button>
          <ConfirmDelete onConfirm={onDelete} label={t('setup.delete')} size="sm" />
        </div>
      )}
    </div>
  )
}
