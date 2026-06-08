import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'

export default function SignalPopover({ signal, area, open, onClose, onSave }) {
  const { t } = useTranslation()
  const role = useAuthStore((s) => s.role)
  const isAdmin = role === 'admin'

  const [enabled, setEnabled] = useState(signal?.enabled !== false)
  const [threshold, setThreshold] = useState(
    Math.round((signal?.threshold_override || signal?.default_threshold || 0.43) * 100)
  )
  const [action, setAction] = useState(
    signal?.action_override || signal?.default_action || 'notify'
  )

  if (!open || !signal) return null

  const actions = ['statistic', 'notify', 'alarm']

  function handleSave() {
    if (onSave) {
      onSave({
        ...signal,
        enabled,
        threshold_override: threshold / 100,
        action_override: action,
      })
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center animate-in fade-in duration-150"
      style={{ background: 'rgba(17,24,39,0.30)' }}
      onClick={onClose}
    >
      <div
        className="w-[340px] bg-surface rounded-lg shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
        style={{ animationTimingFunction: 'cubic-bezier(.4,0,.2,1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3.5 border-b border-line flex items-center justify-between">
          <div>
            <div className="text-sm font-bold">{signal.name || signal.id}</div>
            <div className="text-[11.5px] text-ink-3 mt-0.5">
              {area?.name} · <span className="font-mono">{signal.id}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-sm border border-line bg-surface inline-flex items-center justify-center text-ink-3 hover:bg-bg-2 transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Enabled */}
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-1">{t('common.enabled')}</span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!isAdmin}
            />
          </div>

          {/* Threshold */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-medium text-ink-1">{t('common.threshold')}</span>
              <span className="font-mono text-[13px] font-semibold text-accent">
                {(threshold / 100).toFixed(2)}
              </span>
            </div>
            <Slider
              value={[threshold]}
              onValueChange={([v]) => setThreshold(v)}
              min={10}
              max={90}
              step={1}
              disabled={!isAdmin}
            />
          </div>

          {/* Action */}
          <div>
            <div className="text-[13px] font-medium text-ink-1 mb-2">{t('common.action')}</div>
            <div className="flex gap-1">
              {actions.map((a) => (
                <button
                  key={a}
                  onClick={() => isAdmin && setAction(a)}
                  disabled={!isAdmin}
                  className="flex-1 h-8 rounded-sm text-xs font-semibold border transition cursor-pointer disabled:cursor-default"
                  style={{
                    borderColor: action === a ? 'var(--accent)' : 'var(--line)',
                    background: action === a ? 'var(--accent-soft)' : 'var(--surface)',
                    color: action === a ? 'var(--accent-ink)' : 'var(--ink-3)',
                  }}
                >
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-line flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={handleSave}>
              {t('common.save')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
