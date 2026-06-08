import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Bot, ChevronDown, ChevronRight, FileText, Plus, Sparkles, X } from 'lucide-react'
import { usePrompts, useCreatePrompt, useDeletePrompt } from '@/hooks/useSignals'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import EmptyState from '@/components/iqframe/EmptyState'
import Spinner from '@/components/iqframe/Spinner'
import ConfirmDelete from '@/components/iqframe/ConfirmDelete'

// ── New-prompt inline form ────────────────────────────────────────────────────
function NewPromptForm({ onClose, t }) {
  const [key, setKey] = useState('')
  const [promptText, setPromptText] = useState('')
  const [error, setError] = useState('')
  const createPrompt = useCreatePrompt()

  const keyOk = /^[a-z0-9_]+$/.test(key) && key.length >= 2
  const canSave = keyOk && promptText.trim().length > 0 && !createPrompt.isPending

  async function handleSave() {
    setError('')
    try {
      await createPrompt.mutateAsync({ key, prompt: promptText })
      onClose()
    } catch (err) {
      setError(err.message || 'Error')
    }
  }

  return (
    <div className="border border-accent rounded-md bg-surface p-4 mb-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold text-ink">{t('setup.prompt_new')}</div>
        <button type="button" onClick={onClose} className="text-ink-4 hover:text-ink-2 cursor-pointer">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <Label className="text-[12px] mb-1 block">{t('setup.prompt_key')}</Label>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder="my_signal_context"
            className="font-mono text-sm"
          />
          <p className="text-[11px] text-ink-4 mt-0.5">{t('setup.prompt_key_hint')}</p>
        </div>

        <div>
          <Label className="text-[12px] mb-1 block">{t('setup.prompt_label')}</Label>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder={t('setup.prompt_placeholder')}
            rows={8}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-[11.5px] font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
          />
        </div>
      </div>

      {error && <p className="text-[12px] text-alarm">{error}</p>}

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!canSave} onClick={handleSave}>
          {createPrompt.isPending ? t('common.saving') : t('setup.prompt_create')}
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </div>
  )
}

// ── Single prompt row ─────────────────────────────────────────────────────────
function PromptRow({ prompt, t }) {
  const [open, setOpen] = useState(false)

  const [promptText, setPromptText] = useState('')
  const [promptOrig, setPromptOrig] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)
  const [promptMsg, setPromptMsg] = useState(null)

  const [finalEvalText, setFinalEvalText] = useState('')
  const [finalEvalOrig, setFinalEvalOrig] = useState('')
  const [finalEvalSaving, setFinalEvalSaving] = useState(false)
  const [finalEvalMsg, setFinalEvalMsg] = useState(null)

  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)

  const deletePrompt = useDeletePrompt()

  async function handleExpand() {
    if (!open && !loaded) {
      setLoading(true)
      try {
        const d = await apiFetch(`/api/config/prompts/${encodeURIComponent(prompt.key)}`)
        const p = d.prompt || ''; const fe = d.final_eval || ''
        setPromptText(p); setPromptOrig(p)
        setFinalEvalText(fe); setFinalEvalOrig(fe)
        setLoaded(true)
      } catch { setLoaded(true) }
      finally { setLoading(false) }
    }
    setOpen((v) => !v)
  }

  async function handleSavePrompt() {
    setPromptSaving(true); setPromptMsg(null)
    try {
      await apiFetch(`/api/config/prompts/${encodeURIComponent(prompt.key)}`, {
        method: 'PATCH', body: JSON.stringify({ prompt: promptText }),
      })
      setPromptOrig(promptText)
      setPromptMsg({ ok: true, text: t('common.saved') })
    } catch (err) { setPromptMsg({ ok: false, text: err.message }) }
    finally { setPromptSaving(false) }
  }

  async function handleSaveFinalEval() {
    setFinalEvalSaving(true); setFinalEvalMsg(null)
    try {
      await apiFetch(`/api/config/prompts/${encodeURIComponent(prompt.key)}`, {
        method: 'PATCH', body: JSON.stringify({ final_eval: finalEvalText || null }),
      })
      setFinalEvalOrig(finalEvalText)
      setFinalEvalMsg({ ok: true, text: t('setup.final_eval_saved') })
    } catch (err) { setFinalEvalMsg({ ok: false, text: err.message }) }
    finally { setFinalEvalSaving(false) }
  }

  return (
    <div className="border border-line rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface">
        <button
          type="button"
          onClick={handleExpand}
          className="flex-1 flex items-center gap-3 text-left cursor-pointer min-w-0"
        >
          <Bot size={15} className="text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[12.5px] font-semibold text-ink truncate">{prompt.key}</div>
            {prompt.preview && (
              <div className="text-[11px] text-ink-4 truncate mt-0.5">{prompt.preview}</div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {prompt.has_final_eval && (
              <Sparkles size={11} className="text-accent" />
            )}
            {loading
              ? <Spinner size={14} />
              : open
                ? <ChevronDown size={14} className="text-ink-4" />
                : <ChevronRight size={14} className="text-ink-4" />
            }
          </div>
        </button>

        {/* Delete button */}
        <div className="flex-shrink-0 ml-1">
          <ConfirmDelete
            onConfirm={() => deletePrompt.mutate(prompt.key)}
            label={t('setup.delete')}
          />
        </div>
      </div>

      {/* Expanded content */}
      {open && loaded && (
        <div className="border-t border-line divide-y divide-line">

          {/* Vision prompt editor */}
          <div className="px-4 py-4 bg-bg space-y-2.5">
            <div>
              <div className="text-[12px] font-semibold text-ink-2">{t('setup.prompt_label')}</div>
              <p className="text-[11px] text-ink-4 mt-0.5">{t('setup.prompt_desc')}</p>
            </div>
            <textarea
              value={promptText}
              onChange={(e) => { setPromptText(e.target.value); setPromptMsg(null) }}
              rows={12}
              className="w-full rounded-md border border-input bg-surface px-3 py-2 text-[11.5px] font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
            />
            <div className="flex items-center gap-2.5">
              <Button size="sm" variant="outline"
                disabled={promptSaving || promptText === promptOrig}
                onClick={handleSavePrompt} className="h-7 text-xs">
                {promptSaving ? t('common.saving') : t('setup.prompt_save')}
              </Button>
              {promptText !== promptOrig && !promptSaving && (
                <button type="button" onClick={() => { setPromptText(promptOrig); setPromptMsg(null) }}
                  className="text-[11px] text-ink-4 hover:text-ink-2 cursor-pointer">
                  {t('setup.final_eval_revert')}
                </button>
              )}
              {promptMsg && (
                <span className={`text-[11px] font-medium ${promptMsg.ok ? 'text-ok' : 'text-alarm'}`}>
                  {promptMsg.text}
                </span>
              )}
            </div>
          </div>

          {/* Final eval editor */}
          <div className="px-4 py-4 bg-bg space-y-2.5">
            <div>
              <div className="text-[12px] font-semibold text-ink-2">{t('setup.final_eval')}</div>
              <p className="text-[11px] text-ink-4 mt-0.5">{t('setup.final_eval_desc')}</p>
            </div>
            <textarea
              value={finalEvalText}
              onChange={(e) => { setFinalEvalText(e.target.value); setFinalEvalMsg(null) }}
              placeholder={t('setup.final_eval_placeholder')}
              rows={7}
              className="w-full rounded-md border border-input bg-surface px-3 py-2 text-[11.5px] font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
            />
            <div className="flex items-center gap-2.5">
              <Button size="sm" variant="outline"
                disabled={finalEvalSaving || finalEvalText === finalEvalOrig}
                onClick={handleSaveFinalEval} className="h-7 text-xs">
                {finalEvalSaving ? t('common.saving') : t('setup.final_eval_save')}
              </Button>
              {finalEvalText !== finalEvalOrig && !finalEvalSaving && (
                <button type="button" onClick={() => { setFinalEvalText(finalEvalOrig); setFinalEvalMsg(null) }}
                  className="text-[11px] text-ink-4 hover:text-ink-2 cursor-pointer">
                  {t('setup.final_eval_revert')}
                </button>
              )}
              {finalEvalMsg && (
                <span className={`text-[11px] font-medium ${finalEvalMsg.ok ? 'text-ok' : 'text-alarm'}`}>
                  {finalEvalMsg.text}
                </span>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PromptList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: prompts, isLoading } = usePrompts()
  const [showNew, setShowNew] = useState(false)

  const byFile = (prompts || []).reduce((acc, p) => {
    ;(acc[p.file] = acc[p.file] || []).push(p)
    return acc
  }, {})

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-1">
        <span className="cursor-pointer hover:text-ink-2" onClick={() => navigate('/setup')}>
          {t('nav.setup')}
        </span>
        <span>/</span>
        <span className="text-ink-2">{t('setup.prompts')}</span>
      </div>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[27px] font-bold tracking-tight text-ink">{t('setup.prompts')}</h1>
          <p className="text-sm text-ink-3 mt-0.5">{t('setup.prompts_subtitle')}</p>
        </div>
        <Button onClick={() => setShowNew((v) => !v)} className="flex-shrink-0">
          <Plus size={16} className="mr-1.5" />
          {t('setup.prompt_new')}
        </Button>
      </div>

      {showNew && (
        <NewPromptForm t={t} onClose={() => setShowNew(false)} />
      )}

      {(!prompts || prompts.length === 0) ? (
        <EmptyState
          icon={FileText}
          title={t('setup.prompts_empty')}
          hint={t('setup.prompts_empty_hint')}
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(byFile).map(([file, items]) => (
            <div key={file}>
              <div className="flex items-center gap-2 mb-2.5">
                <FileText size={13} className="text-ink-4" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{file}</span>
                <span className="text-[11px] text-ink-4">· {items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((p) => (
                  <PromptRow key={p.key} prompt={p} t={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
