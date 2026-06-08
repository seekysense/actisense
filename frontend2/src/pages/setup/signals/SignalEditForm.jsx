import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useConfig } from '@/hooks/useConfig'
import { useSignalDetail, useCreateSignal, useUpdateSignal } from '@/hooks/useSignals'
import SignalConfigFields from '@/components/setup/SignalConfigFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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

export default function SignalEditForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const isAdmin = useAuthStore((s) => s.role) === 'admin'
  const isCreate = !id

  const { data: config } = useConfig()
  const { data: existing } = useSignalDetail(id)
  const createSignal = useCreateSignal()
  const updateSignal = useUpdateSignal(id)

  const [form, setForm] = useState({ ...emptySignal })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isCreate) {
      setForm({ ...emptySignal })
    } else if (existing) {
      setForm({ ...emptySignal, ...existing })
    }
  }, [existing, isCreate])

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-ink-3">
        {t('setup.readonly_notice')}
      </div>
    )
  }

  const areas = config?.areas || []

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!form.id || form.id.length < 3) {
      setError(t('setup.camera_id_hint'))
      return
    }
    if (!form.name || form.name.length < 2) {
      setError(t('setup.display_name_required'))
      return
    }
    if (!form.text) {
      setError(t('setup.semantic_phrase_hint'))
      return
    }

    setSaving(true)
    try {
      const payload = {
        id: form.id,
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

      if (isCreate) {
        await createSignal.mutateAsync(payload)
        alert(t('setup.signal_created'))
      } else {
        await updateSignal.mutateAsync(payload)
        alert(t('setup.signal_updated'))
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
          {isCreate ? t('setup.new_signal') : id}
        </span>
      </div>

      <h1 className="text-[27px] font-bold tracking-tight text-ink mb-5">
        {isCreate ? t('setup.new_signal') : t('setup.edit_signal')}
      </h1>

      <form onSubmit={handleSubmit} className="max-w-[720px]">
        <div className="bg-surface border border-line rounded-md p-5 space-y-5">
          {/* ID */}
          <div>
            <Label htmlFor="sig-id">{t('setup.signal_id')}</Label>
            <Input
              id="sig-id"
              value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              disabled={!isCreate}
              className="mt-1.5 font-mono"
              required
            />
            {isCreate && form.name && !form.id && (
              <p className="text-[11px] text-ink-4 mt-1">
                {t('setup.camera_id_hint')}
              </p>
            )}
          </div>

          <SignalConfigFields value={form} onChange={setForm} areas={areas} />

          {error && <p className="text-sm text-alarm">{error}</p>}
        </div>

        <div className="flex items-center gap-3 mt-5">
          <Button type="submit" disabled={saving}>
            {saving ? t('common.saving') : isCreate ? t('setup.create_signal') : t('setup.save_changes')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/setup/signals')}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </div>
  )
}
