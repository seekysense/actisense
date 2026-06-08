import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, Signal } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useSignals, useCreateSignal, useDeleteSignal } from '@/hooks/useSignals'
import SignalRowCard from '@/components/setup/SignalRowCard'
import EmptyState from '@/components/iqframe/EmptyState'
import { Button } from '@/components/ui/button'

export default function SignalList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.role) === 'admin'
  const [search, setSearch] = useState('')

  const { data: signals, isLoading } = useSignals()
  const createSignal = useCreateSignal()
  const deleteSignal = useDeleteSignal()

  const filtered = useMemo(() => {
    if (!signals) return []
    if (!search.trim()) return signals
    const q = search.toLowerCase()
    return signals.filter(
      (s) =>
        s.id?.toLowerCase().includes(q) ||
        s.name?.toLowerCase().includes(q) ||
        s.text?.toLowerCase().includes(q)
    )
  }, [signals, search])

  async function handleClone(sig) {
    const newId = `${sig.id}_copy`
    try {
      await createSignal.mutateAsync({
        ...sig,
        id: newId,
        name: sig.name ? `${sig.name} (copy)` : newId,
      })
    } catch (err) {
      alert(t('setup.clone_failed') + ': ' + (err.message || '409'))
    }
  }

  async function handleDelete(id) {
    try {
      await deleteSignal.mutateAsync(id)
    } catch (err) {
      alert(t('setup.delete_failed') + ': ' + err.message)
    }
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
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-1">
            <span className="cursor-pointer hover:text-ink-2" onClick={() => navigate('/setup')}>
              {t('nav.setup')}
            </span>
            <span>/</span>
            <span>{t('nav.signals')}</span>
          </div>
          <h1 className="text-[27px] font-bold tracking-tight text-ink">
            {t('setup.signal_library')} · {filtered.length}
          </h1>
        </div>
        {isAdmin && (
          <Button onClick={() => navigate('/setup/signals/new')} className="gap-1.5">
            <Plus size={16} />
            {t('setup.new_signal')}
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="mb-4 max-w-[420px]">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('dashboard.filters') + '…'}
            className="w-full h-10 pl-10 pr-4 rounded-md border border-line-2 bg-bg text-sm text-ink outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition"
          />
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Signal}
          title={t('setup.no_signals')}
          hint={t('setup.no_signals_hint')}
          action={
            isAdmin && (
              <Button onClick={() => navigate('/setup/signals/new')}>
                {t('setup.new_signal')}
              </Button>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((s) => (
            <SignalRowCard
              key={s.id}
              signal={s}
              isAdmin={isAdmin}
              onEdit={() => navigate(`/setup/signals/${s.id}/edit`)}
              onClone={() => handleClone(s)}
              onDelete={() => handleDelete(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
