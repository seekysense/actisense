import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Plus, Users, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { useUsers, useCreateUser, useDeleteUser, useSetUserPassword } from '@/hooks/useUsers'
import ConfirmDelete from '@/components/iqframe/ConfirmDelete'
import EmptyState from '@/components/iqframe/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

// ── Add user dialog ────────────────────────────────────────────────

function AddUserDialog({ open, onClose }) {
  const { t } = useTranslation()
  const createUser = useCreateUser()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  function reset() {
    setEmail('')
    setPassword('')
    setErr('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!email.trim()) return setErr(t('users.email_required'))
    if (password.length < 6) return setErr(t('profile.password_min'))
    try {
      await createUser.mutateAsync({ email: email.trim(), password })
      toast.success(t('users.user_created'))
      reset()
      onClose()
    } catch (ex) {
      const msg = ex?.message || ''
      setErr(msg.includes('409') || msg.includes('already') ? t('users.email_exists') : t('errors.saving'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('users.add_user')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 pt-1">
          <div>
            <Label htmlFor="au-email">{t('users.email')}</Label>
            <Input
              id="au-email"
              type="text"
              className="mt-1.5"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="au-pw">{t('users.password')}</Label>
            <Input
              id="au-pw"
              type="password"
              className="mt-1.5"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {err && <p className="text-xs text-alarm">{err}</p>}
          <DialogFooter className="pt-1">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose() }}>
              {t('setup.cancel')}
            </Button>
            <Button type="submit" disabled={createUser.isPending}>
              {createUser.isPending ? t('common.saving') : t('users.add_user')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Set password dialog ────────────────────────────────────────────

function SetPasswordDialog({ email, onClose }) {
  const { t } = useTranslation()
  const setPassword = useSetUserPassword()
  const [password, setPasswordVal] = useState('')
  const [err, setErr] = useState('')

  function reset() {
    setPasswordVal('')
    setErr('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (password.length < 6) return setErr(t('profile.password_min'))
    try {
      await setPassword.mutateAsync({ email, password })
      toast.success(t('users.password_updated'))
      reset()
      onClose()
    } catch {
      setErr(t('errors.saving'))
    }
  }

  return (
    <Dialog open={!!email} onOpenChange={(v) => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('users.set_password')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 pt-1">
          <div>
            <Label>{t('users.email')}</Label>
            <p className="mt-1 text-sm text-ink-2 font-medium truncate">{email}</p>
          </div>
          <div>
            <Label htmlFor="sp-pw">{t('users.new_password')}</Label>
            <Input
              id="sp-pw"
              type="password"
              className="mt-1.5"
              value={password}
              onChange={(e) => setPasswordVal(e.target.value)}
              autoFocus
            />
          </div>
          {err && <p className="text-xs text-alarm">{err}</p>}
          <DialogFooter className="pt-1">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose() }}>
              {t('setup.cancel')}
            </Button>
            <Button type="submit" disabled={setPassword.isPending}>
              {setPassword.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ──────────────────────────────────────────────────────

export default function UserList() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { data: users = [], isLoading } = useUsers()
  const deleteUser = useDeleteUser()

  const [addOpen, setAddOpen] = useState(false)
  const [pwEmail, setPwEmail] = useState(null) // email | null

  async function handleDelete(email) {
    try {
      await deleteUser.mutateAsync(email)
      toast.success(t('users.user_deleted'))
    } catch {
      toast.error(t('errors.saving'))
    }
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString(i18n.language === 'it' ? 'it-IT' : 'en-GB')
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
            <span>{t('setup.users')}</span>
          </div>
          <h1 className="text-[27px] font-bold tracking-tight text-ink">
            {t('users.title')} · {users.length}
          </h1>
          <p className="text-sm text-ink-3 mt-1">{t('users.subtitle')}</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-1.5">
          <Plus size={16} />
          {t('users.add_user')}
        </Button>
      </div>

      {/* Table */}
      {users.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('users.no_users')}
          hint={t('users.no_users_hint')}
          action={<Button onClick={() => setAddOpen(true)}>{t('users.add_user')}</Button>}
        />
      ) : (
        <div className="bg-surface border border-line rounded-md overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 border-b border-line bg-bg text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            <span>{t('users.email')}</span>
            <span>{t('users.role')}</span>
            <span>{t('users.created_at')}</span>
            <span />
          </div>

          {/* Rows */}
          {users.map((u) => (
            <div
              key={u.email}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-4 py-3 border-b border-line last:border-0 hover:bg-bg transition"
            >
              <span className="text-sm text-ink-1 font-medium truncate">{u.email}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-bg-2 text-ink-3 font-medium capitalize">
                {u.role}
              </span>
              <span className="text-xs text-ink-3 whitespace-nowrap">
                {u.created_at ? formatDate(u.created_at) : '—'}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPwEmail(u.email)}
                  title={t('users.set_password')}
                  className="inline-flex items-center justify-center w-[34px] h-[34px] rounded-sm border border-line bg-surface text-ink-3 hover:text-ink-1 hover:bg-bg-2 transition cursor-pointer"
                >
                  <KeyRound size={16} />
                </button>
                <ConfirmDelete
                  label={t('users.delete_user')}
                  onConfirm={() => handleDelete(u.email)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialogs */}
      <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <SetPasswordDialog email={pwEmail} onClose={() => setPwEmail(null)} />
    </div>
  )
}
