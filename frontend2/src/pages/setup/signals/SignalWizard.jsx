import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useConfig } from '@/hooks/useConfig'
import { useSignalDetail, useCreateSignal, useUpdateSignal } from '@/hooks/useSignals'
import SignalConfigFields from '@/components/setup/SignalConfigFields'
import { Button } from '@/components/ui/button'

const TEMPLATES = [
  { key: 'person', name: 'tpl_person', desc: 'tpl_person_desc', text: 'A person detected in the scene', priority: 3, default_action: 'notify' },
  { key: 'vehicle', name: 'tpl_vehicle', desc: 'tpl_vehicle_desc', text: 'A vehicle detected in the scene', priority: 3, default_action: 'notify' },
  { key: 'anomaly', name: 'tpl_anomaly', desc: 'tpl_anomaly_desc', text: 'Unusual posture, loitering or abandoned object', priority: 2, default_action: 'alarm' },
  { key: 'crowd', name: 'tpl_crowd', desc: 'tpl_crowd_desc', text: 'A group of 3 or more people in close proximity', priority: 3, default_action: 'notify' },
  { key: 'fire', name: 'tpl_fire', desc: 'tpl_fire_desc', text: 'Visual signs of fire or dense smoke', priority: 1, default_action: 'alarm' },
]

const emptySignal = {
  id: '',
  name: '',
  text: '',
  priority: 3,
  default_threshold: 0.43,
  default_action: 'notify',
  source: 'embedder',
  escalation_llm: false,
  llm_prompt_key: null,
  cooldown_sec: 300,
  temporal_context_sec: 0,
  zone: [],
  webhook: null,
}

function sanitizeId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

function StepBar({ step, labels }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {labels.map((label, i) => {
        const n = i + 1
        const done = step > n
        const active = step === n
        return (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border transition ${
                done
                  ? 'bg-ok border-ok text-white'
                  : active
                  ? 'bg-accent border-accent text-white'
                  : 'bg-surface border-line text-ink-4'
              }`}
            >
              {done ? '✓' : n}
            </div>
            <span
              className={`text-[11.5px] font-semibold ${
                active ? 'text-ink-1' : 'text-ink-4'
              }`}
            >
              {label}
            </span>
            {i < labels.length - 1 && (
              <div className="w-6 h-px bg-line mx-1" />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function SignalWizard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const isAdmin = useAuthStore((s) => s.role) === 'admin'
  const isEdit = !!id

  const { data: config } = useConfig()
  const { data: existing } = useSignalDetail(id)
  const createSignal = useCreateSignal()
  const updateSignal = useUpdateSignal(id)

  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ ...emptySignal })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isEdit && existing) {
      setForm({ ...emptySignal, ...existing })
    }
  }, [existing, isEdit])

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-ink-3">
        {t('setup.readonly_notice')}
      </div>
    )
  }

  const areas = config?.areas || []
  const labels = [t('setup.step_type'), t('setup.step_config'), t('setup.step_review')]

  function pickTemplate(tpl) {
    setForm({
      ...emptySignal,
      id: sanitizeId(t(tpl.name)),
      name: t(tpl.name),
      text: t(tpl.desc),
      priority: tpl.priority,
      default_action: tpl.default_action,
    })
    setStep(2)
  }

  function pickCustom() {
    setForm({ ...emptySignal })
    setStep(2)
  }

  function canNext() {
    if (step === 2) {
      return form.name?.length >= 2 && form.text?.length > 0
    }
    return true
  }

  async function handleSave() {
    setError('')
    const idVal = isEdit ? id : (form.id || sanitizeId(form.name))
    if (idVal.length < 3) {
      setError(t('setup.camera_id_hint'))
      return
    }

    setSaving(true)
    try {
      const payload = {
        id: idVal,
        name: form.name,
        text: form.text,
        priority: form.priority,
        default_threshold: form.default_threshold,
        default_action: form.default_action,
        source: form.source,
        escalation_llm: form.escalation_llm,
        llm_prompt_key: form.llm_prompt_key,
        cooldown_sec: form.cooldown_sec,
        temporal_context_sec: form.temporal_context_sec,
        zone: form.zone?.length ? form.zone : undefined,
        webhook: form.webhook || undefined,
      }

      if (isEdit) {
        await updateSignal.mutateAsync(payload)
        alert(t('setup.signal_updated'))
      } else {
        await createSignal.mutateAsync(payload)
        alert(t('setup.signal_created'))
      }
      navigate('/setup/signals')
    } catch (err) {
      setError(err.message || 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-1">
        <span className="cursor-pointer hover:text-ink-2" onClick={() => navigate('/setup')}>
          {t('nav.setup')}
        </span>
        <span>/</span>
        <span className="cursor-pointer hover:text-ink-2" onClick={() => navigate('/setup/signals')}>
          {t('nav.signals')}
        </span>
        <span>/</span>
        <span className="text-ink-2">
          {isEdit ? t('setup.edit_signal') : t('setup.new_signal')}
        </span>
      </div>

      <h1 className="text-[27px] font-bold tracking-tight text-ink mb-1">
        {isEdit ? t('setup.edit_signal') : t('setup.new_signal')}
      </h1>

      <StepBar step={step} labels={labels} />

      {/* Step 1 — Template */}
      {step === 1 && (
        <div className="space-y-3 max-w-[600px]">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.key}
              onClick={() => pickTemplate(tpl)}
              className="w-full text-left px-4 py-3 bg-surface border border-line rounded-md hover:border-accent transition cursor-pointer"
            >
              <div className="text-[14px] font-semibold text-ink-1">{t(`setup.${tpl.name}`)}</div>
              <div className="text-[12.5px] text-ink-3 mt-0.5">{t(`setup.${tpl.desc}`)}</div>
            </button>
          ))}
          <button
            onClick={pickCustom}
            className="w-full text-left px-4 py-3 bg-surface border border-line rounded-md hover:border-accent transition cursor-pointer"
          >
            <div className="text-[14px] font-semibold text-ink-1">{t('setup.custom_signal')}</div>
            <div className="text-[12.5px] text-ink-3 mt-0.5">{t('setup.custom_signal_desc')}</div>
          </button>
        </div>
      )}

      {/* Step 2 — Config */}
      {step === 2 && (
        <div className="max-w-[720px]">
          <div className="bg-surface border border-line rounded-md p-5 space-y-5">
            {!isEdit && (
              <div>
                <label className="text-sm font-medium">{t('setup.signal_id')}</label>
                <input
                  value={form.id || ''}
                  onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                  className="mt-1.5 w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <p className="text-[11px] text-ink-4 mt-1">{t('setup.camera_id_hint')}</p>
              </div>
            )}
            <SignalConfigFields value={form} onChange={setForm} areas={areas} />
          </div>
          <div className="flex items-center gap-3 mt-5">
            <Button onClick={() => setStep(3)} disabled={!canNext()}>
              {t('setup.review_and_save')}
            </Button>
            <Button variant="outline" onClick={() => setStep(1)}>
              {t('common.back')}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3 — Review */}
      {step === 3 && (
        <div className="max-w-[720px]">
          <div className="bg-surface border border-line rounded-md p-5 space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <span className="text-ink-4">{t('setup.signal_id')}</span>
                <div className="font-mono font-semibold text-ink-1">{isEdit ? id : (form.id || sanitizeId(form.name))}</div>
              </div>
              <div>
                <span className="text-ink-4">{t('setup.display_name')}</span>
                <div className="font-semibold text-ink-1">{form.name}</div>
              </div>
              <div>
                <span className="text-ink-4">{t('setup.priority')}</span>
                <div className="font-semibold text-ink-1">P{form.priority}</div>
              </div>
              <div>
                <span className="text-ink-4">{t('setup.action')}</span>
                <div className="font-semibold text-ink-1 capitalize">{form.default_action}</div>
              </div>
              <div>
                <span className="text-ink-4">{t('setup.threshold_sensitivity')}</span>
                <div className="font-mono font-semibold text-ink-1">{(form.default_threshold ?? 0.43).toFixed(2)}</div>
              </div>
              <div>
                <span className="text-ink-4">{t('setup.source')}</span>
                <div className="font-semibold text-ink-1">{form.source}</div>
              </div>
            </div>
            <div className="p-3 bg-bg-2 rounded-md border border-line">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                {t('setup.semantic_phrase')}
              </span>
              <p className="text-[13px] text-ink-1 italic mt-1">“{form.text}”</p>
            </div>
          </div>

          {error && <p className="text-sm text-alarm mt-3">{error}</p>}

          <div className="flex items-center gap-3 mt-5">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t('common.saving') : isEdit ? t('setup.save_changes') : t('setup.create_signal')}
            </Button>
            <Button variant="outline" onClick={() => setStep(2)}>
              {t('common.back')}
            </Button>
            <Button variant="ghost" onClick={() => navigate('/setup/signals')}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
