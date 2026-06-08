import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import PriorityChip from '@/components/iqframe/PriorityChip'
import { usePrompts } from '@/hooks/useSignals'
import { apiFetch } from '@/lib/api'
import { ChevronDown, ChevronUp, Bot, Sparkles, Webhook, Check } from 'lucide-react'

const DEFAULT_ACTIONS = ['statistic', 'notify', 'alarm']
const SOURCES = ['embedder', 'native_axis']

// ── Layout helpers ────────────────────────────────────────────────────────────
function SectionTitle({ children }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 pb-2 border-b border-line">
      {children}
    </div>
  )
}

function FieldRow({ label, hint, children }) {
  return (
    <div>
      <Label className="text-[13px]">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-ink-4 mt-1">{hint}</p>}
    </div>
  )
}

// ── Webhook section ───────────────────────────────────────────────────────────
function WebhookSection({ action, webhook, onChange, t }) {
  const wh = webhook || {}

  function set(path, val) {
    const [key, field] = path.split('.')
    const next = { ...wh, [key]: { ...(wh[key] || {}), [field]: val } }
    Object.keys(next).forEach((k) => {
      if (!next[k]?.url) delete next[k]
    })
    onChange(Object.keys(next).length ? next : null)
  }

  if (action === 'statistic') {
    return (
      <p className="text-[12.5px] text-ink-4 italic">{t('setup.webhook_not_applicable')}</p>
    )
  }

  const BadgePill = ({ color, label }) => (
    <span
      className="inline-flex items-center px-2 py-[2px] rounded-pill text-[10.5px] font-semibold border flex-shrink-0 w-[58px] justify-center"
      style={{ background: `${color}18`, borderColor: color, color }}
    >
      {label}
    </span>
  )

  return (
    <div className="space-y-3">
      {action === 'notify' && (
        <div className="flex items-center gap-2.5">
          <BadgePill color="var(--sev-notify)" label="notify" />
          <Input
            value={wh.notify?.url || ''}
            onChange={(e) => set('notify.url', e.target.value)}
            placeholder="https://hooks.example.com/notify"
            className="flex-1 font-mono text-xs h-8"
          />
        </div>
      )}

      {action === 'alarm' && (
        <div className="space-y-3">
          {/* Primary */}
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <BadgePill color="var(--sev-alarm)" label="primary" />
              <Input
                value={wh.alarm_primary?.url || ''}
                onChange={(e) => set('alarm_primary.url', e.target.value)}
                placeholder="https://hooks.example.com/alarm"
                className="flex-1 font-mono text-xs h-8"
              />
            </div>
            <div className="flex items-center gap-2 pl-[70px]">
              <span className="text-[11.5px] text-ink-3">{t('setup.webhook_retries')}</span>
              <Select
                value={String(wh.alarm_primary?.retries ?? 3)}
                onValueChange={(v) => set('alarm_primary.retries', parseInt(v))}
              >
                <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 5, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Fallback */}
          <div className="pt-3 border-t border-dashed border-line">
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="inline-flex items-center px-2 py-[2px] rounded-pill text-[10.5px] font-semibold border border-line text-ink-3 bg-bg-2 w-[58px] justify-center flex-shrink-0">
                fallback
              </span>
              <Input
                value={wh.alarm_fallback?.url || ''}
                onChange={(e) => set('alarm_fallback.url', e.target.value)}
                placeholder={t('setup.webhook_fallback_optional')}
                className="flex-1 font-mono text-xs h-8"
              />
            </div>
            {wh.alarm_fallback?.url && (
              <div className="flex items-center gap-2 pl-[70px] mb-1.5">
                <span className="text-[11.5px] text-ink-3">{t('setup.webhook_retries')}</span>
                <Select
                  value={String(wh.alarm_fallback?.retries ?? 2)}
                  onValueChange={(v) => set('alarm_fallback.retries', parseInt(v))}
                >
                  <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 5, 10].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <p className="text-[11px] text-ink-4 pl-[70px]">{t('setup.webhook_fallback_desc')}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── LLM prompt selector + final eval editor ───────────────────────────────────
function LlmSection({ llmPromptKey, onChange, t }) {
  const { data: prompts = [], isLoading } = usePrompts()
  const [open, setOpen] = useState(false)
  const [finalEvalText, setFinalEvalText] = useState('')
  const [finalEvalOrig, setFinalEvalOrig] = useState('')
  const [feLoading, setFeLoading]         = useState(false)
  const [feSaving, setFeSaving]           = useState(false)
  const [feMsg, setFeMsg]                 = useState(null)

  const selectedPrompt = prompts.find((p) => p.key === llmPromptKey)

  useEffect(() => {
    if (!llmPromptKey) { setFinalEvalText(''); setFinalEvalOrig(''); return }
    setFeLoading(true); setFeMsg(null)
    apiFetch(`/api/config/prompts/${encodeURIComponent(llmPromptKey)}`)
      .then((d) => { const v = d.final_eval || ''; setFinalEvalText(v); setFinalEvalOrig(v) })
      .catch(() => { setFinalEvalText(''); setFinalEvalOrig('') })
      .finally(() => setFeLoading(false))
  }, [llmPromptKey])

  const saveFinalEval = async () => {
    setFeSaving(true); setFeMsg(null)
    try {
      await apiFetch(`/api/config/prompts/${encodeURIComponent(llmPromptKey)}`, {
        method: 'PATCH',
        body: JSON.stringify({ final_eval: finalEvalText || null }),
      })
      setFinalEvalOrig(finalEvalText)
      setFeMsg({ ok: true, text: t('setup.final_eval_saved') })
    } catch (err) {
      setFeMsg({ ok: false, text: err.message })
    }
    setFeSaving(false)
  }

  const byFile = prompts.reduce((acc, p) => {
    ;(acc[p.file] = acc[p.file] || []).push(p)
    return acc
  }, {})

  return (
    <div className="space-y-3">
      {/* Prompt picker */}
      <div>
        <Label className="text-[13px] mb-1.5 block">{t('setup.llm_prompt')}</Label>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2.5 px-3 py-2 border border-line rounded-md bg-surface hover:border-accent transition text-left cursor-pointer"
        >
          {llmPromptKey ? (
            <>
              <Bot size={15} className="text-accent flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[12px] font-semibold text-ink truncate">{llmPromptKey}</div>
                {selectedPrompt?.preview && (
                  <div className="text-[11px] text-ink-4 truncate">{selectedPrompt.preview}</div>
                )}
              </div>
            </>
          ) : (
            <>
              <Sparkles size={15} className="text-ink-4 flex-shrink-0" />
              <div className="flex-1 text-[12px] text-ink-3 italic">{t('setup.llm_prompt_generic')}</div>
            </>
          )}
          {open
            ? <ChevronUp size={14} className="text-ink-4 flex-shrink-0" />
            : <ChevronDown size={14} className="text-ink-4 flex-shrink-0" />}
        </button>

        {open && (
          <div className="mt-1 border border-line rounded-md overflow-hidden shadow-md bg-surface max-h-72 overflow-y-auto z-10 relative">
            {/* Generic option */}
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left cursor-pointer border-b border-line hover:bg-bg-2 transition ${!llmPromptKey ? 'bg-accent-soft' : ''}`}
            >
              <Sparkles size={14} className={!llmPromptKey ? 'text-accent' : 'text-ink-4'} />
              <div className="flex-1">
                <div className={`text-[12px] font-medium ${!llmPromptKey ? 'text-accent-ink' : 'text-ink-2'}`}>generic</div>
                <div className="text-[11px] text-ink-4">{t('setup.llm_prompt_generic_desc')}</div>
              </div>
              {!llmPromptKey && <Check size={13} className="text-accent flex-shrink-0" />}
            </button>

            {isLoading ? (
              <div className="px-3 py-3 text-[12px] text-ink-4 italic">{t('common.loading')}</div>
            ) : prompts.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-ink-4 italic">{t('setup.llm_prompt_no_prompts')}</div>
            ) : (
              Object.entries(byFile).map(([file, items]) => (
                <div key={file}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-4 bg-bg-2 border-t border-b border-line">
                    {file}
                  </div>
                  {items.map((p) => {
                    const active = llmPromptKey === p.key
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => { onChange(p.key); setOpen(false) }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left cursor-pointer border-b border-line hover:bg-bg-2 transition ${active ? 'bg-accent-soft' : ''}`}
                      >
                        <Bot size={14} className={active ? 'text-accent flex-shrink-0' : 'text-ink-4 flex-shrink-0'} />
                        <div className="flex-1 min-w-0">
                          <div className={`font-mono text-[12px] font-semibold truncate ${active ? 'text-accent-ink' : 'text-ink'}`}>
                            {p.key}
                          </div>
                          {p.preview && (
                            <div className="text-[11px] text-ink-4 truncate">{p.preview}</div>
                          )}
                        </div>
                        {active && <Check size={13} className="text-accent flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        )}

        {/* has_final_eval badge */}
        {!open && llmPromptKey && selectedPrompt?.has_final_eval && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Sparkles size={12} className="text-accent" />
            <span className="text-[11px] text-accent font-medium">{t('setup.llm_prompt_has_final_eval')}</span>
          </div>
        )}
      </div>

      {/* Final eval editor */}
      {llmPromptKey && (
        <div className="border border-line rounded-md p-3.5 bg-bg space-y-2.5">
          <div>
            <div className="text-[12px] font-semibold text-ink-2">{t('setup.final_eval')}</div>
            <p className="text-[11px] text-ink-4 mt-0.5">{t('setup.final_eval_desc')}</p>
          </div>
          {feLoading ? (
            <div className="text-[12px] text-ink-4 italic">{t('common.loading')}</div>
          ) : (
            <>
              <textarea
                value={finalEvalText}
                onChange={(e) => { setFinalEvalText(e.target.value); setFeMsg(null) }}
                placeholder={t('setup.final_eval_placeholder')}
                rows={6}
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-[11.5px] font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              />
              <div className="flex items-center gap-2.5">
                <Button
                  size="sm" variant="outline"
                  disabled={feSaving || finalEvalText === finalEvalOrig}
                  onClick={saveFinalEval}
                  className="h-7 text-xs"
                >
                  {feSaving ? t('common.saving') : t('setup.final_eval_save')}
                </Button>
                {finalEvalText !== finalEvalOrig && !feSaving && (
                  <button
                    type="button"
                    onClick={() => { setFinalEvalText(finalEvalOrig); setFeMsg(null) }}
                    className="text-[11px] text-ink-4 hover:text-ink-2 cursor-pointer"
                  >
                    {t('setup.final_eval_revert')}
                  </button>
                )}
                {feMsg && (
                  <span className={`text-[11px] font-medium ${feMsg.ok ? 'text-ok' : 'text-alarm'}`}>
                    {feMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function SignalConfigFields({ value, onChange, areas = [] }) {
  const { t } = useTranslation()

  function update(patch) {
    onChange({ ...value, ...patch })
  }

  const threshold = value.default_threshold ?? 0.43

  return (
    <div className="space-y-6">
      {/* ── Core fields ──────────────────────────────────────────────────────── */}
      <div className="space-y-5">
        <FieldRow label={t('setup.display_name')}>
          <Input
            value={value.name || ''}
            onChange={(e) => update({ name: e.target.value })}
            className="mt-1.5"
          />
        </FieldRow>

        <FieldRow label={t('setup.semantic_phrase')}>
          <textarea
            value={value.text || ''}
            onChange={(e) => update({ text: e.target.value })}
            rows={3}
            className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />
        </FieldRow>

        <FieldRow label={t('setup.priority')}>
          <div className="flex gap-2 mt-1.5">
            {[1, 2, 3, 4, 5].map((p) => (
              <PriorityChip key={p} p={p} active={value.priority === p} interactive onClick={() => update({ priority: p })} />
            ))}
          </div>
        </FieldRow>

        <FieldRow label={t('common.action')}>
          <div className="flex gap-px mt-1.5 p-[3px] rounded-sm bg-bg-2 border border-line w-fit">
            {DEFAULT_ACTIONS.map((a) => (
              <button key={a} type="button" onClick={() => update({ default_action: a })}
                className={`px-3 py-1 rounded-[2px] text-xs font-semibold transition cursor-pointer ${
                  value.default_action === a ? 'bg-surface text-ink shadow-xs' : 'text-ink-3 hover:text-ink-2'
                }`}>
                {t(`common.${a}`)}
              </button>
            ))}
          </div>
        </FieldRow>

        <FieldRow label={t('setup.threshold_sensitivity')}>
          <div className="flex items-center gap-3 mt-1.5">
            <Slider
              value={[threshold]}
              onValueChange={([v]) => update({ default_threshold: v })}
              min={0} max={1} step={0.01}
              className="flex-1"
            />
            <span className="font-mono text-xs text-ink-3 w-10 text-right">{threshold.toFixed(2)}</span>
          </div>
        </FieldRow>

        <FieldRow label={t('setup.source')}>
          <Select value={value.source || 'embedder'} onValueChange={(v) => update({ source: v })}>
            <SelectTrigger className="mt-1.5 w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'embedder' ? t('setup.embedder') : t('setup.native_axis')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <div className="grid grid-cols-2 gap-4">
          <FieldRow label={`${t('setup.cooldown')} (s)`}>
            <Input type="number" min={0}
              value={value.cooldown_sec ?? 300}
              onChange={(e) => update({ cooldown_sec: parseInt(e.target.value, 10) || 0 })}
              className="mt-1.5"
            />
          </FieldRow>
          <FieldRow label={`${t('setup.temporal_context')} (s)`}>
            <Input type="number" min={0}
              value={value.temporal_context_sec ?? 0}
              onChange={(e) => update({ temporal_context_sec: parseInt(e.target.value, 10) || 0 })}
              className="mt-1.5"
            />
          </FieldRow>
        </div>

        {areas.length > 0 && (
          <FieldRow label={t('setup.zones')}>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {areas.map((a) => {
                const active = (value.zone || []).includes(a.id)
                return (
                  <button key={a.id} type="button"
                    onClick={() => {
                      const curr = value.zone || []
                      update({ zone: active ? curr.filter((z) => z !== a.id) : [...curr, a.id] })
                    }}
                    className={`px-2.5 py-1 rounded-pill text-[11px] font-semibold border transition cursor-pointer ${
                      active ? 'bg-accent text-white border-accent' : 'bg-surface text-ink-3 border-line hover:text-ink-2'
                    }`}>
                    {a.name}
                  </button>
                )
              })}
            </div>
          </FieldRow>
        )}
      </div>

      {/* ── LLM escalation ──────────────────────────────────────────────────── */}
      <div className="space-y-3 pt-1">
        <SectionTitle>
          <Bot size={12} />{t('setup.llm_section')}
        </SectionTitle>

        <div className="flex items-center gap-3">
          <Switch
            id="sig-llm"
            checked={!!value.escalation_llm}
            onCheckedChange={(v) => update({ escalation_llm: v, llm_prompt_key: v ? value.llm_prompt_key : null })}
          />
          <Label htmlFor="sig-llm" className="cursor-pointer text-[13px]">
            {t('setup.escalation_llm')}
          </Label>
        </div>

        {value.escalation_llm && (
          <LlmSection
            llmPromptKey={value.llm_prompt_key || null}
            onChange={(key) => update({ llm_prompt_key: key })}
            t={t}
          />
        )}
      </div>

      {/* ── Webhooks ─────────────────────────────────────────────────────────── */}
      <div className="space-y-3 pt-1">
        <SectionTitle>
          <Webhook size={12} />{t('setup.webhook')}
        </SectionTitle>
        <WebhookSection
          action={value.default_action || 'statistic'}
          webhook={value.webhook}
          onChange={(wh) => update({ webhook: wh })}
          t={t}
        />
      </div>
    </div>
  )
}
