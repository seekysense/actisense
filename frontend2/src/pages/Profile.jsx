import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Clock, KeyRound, UserCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { apiFetch } from '@/lib/api'
import { initials } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

function formatLoginTs(iso, lang) {
  return new Date(iso).toLocaleString(lang === 'it' ? 'it-IT' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Profile() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { username, role, logout } = useAuthStore()

  const [lastLogins, setLastLogins] = useState(null) // null = loading
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    apiFetch('/api/profile')
      .then((data) => setLastLogins(data?.last_logins ?? []))
      .catch(() => {
        setLoadError(true)
        setLastLogins([])
      })
  }, [])

  const schema = z
    .object({
      old_password: z.string().min(1, t('profile.old_password_required')),
      new_password: z.string().min(6, t('profile.password_min')),
      confirm_password: z.string().min(1, t('profile.old_password_required')),
    })
    .refine((d) => d.new_password === d.confirm_password, {
      message: t('profile.password_mismatch'),
      path: ['confirm_password'],
    })

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) })

  async function onSubmit(data) {
    try {
      await apiFetch('/api/profile/password', {
        method: 'PUT',
        body: JSON.stringify({
          old_password: data.old_password,
          new_password: data.new_password,
        }),
      })
      toast.success(t('profile.password_changed'))
      reset()
      setTimeout(() => {
        logout()
        navigate('/login')
      }, 1500)
    } catch (err) {
      const msg = err?.message || ''
      if (msg.includes('incorrect') || msg.includes('Current password')) {
        setError('old_password', { message: t('profile.old_password_wrong') })
      } else {
        toast.error(t('errors.saving'))
      }
    }
  }

  return (
    <div className="max-w-[560px] flex flex-col gap-5">

      {/* ── header ── */}
      <div>
        <h1 className="text-[27px] font-bold tracking-tight text-ink">{t('profile.title')}</h1>
        <p className="text-sm text-ink-3 mt-1">{t('profile.subtitle')}</p>
      </div>

      {/* ── identity card ── */}
      <div className="bg-surface border border-line rounded-md p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-ink text-white flex items-center justify-center text-lg font-bold flex-shrink-0">
          {initials(username)}
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold text-ink-1 truncate">{username}</div>
          <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-accent-soft text-accent font-medium capitalize">
            {role}
          </span>
        </div>
      </div>

      {/* ── change password ── */}
      <div className="bg-surface border border-line rounded-md p-5">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound size={16} className="text-ink-3" />
          <h2 className="text-sm font-semibold text-ink-1">{t('profile.change_password')}</h2>
        </div>

        {role === 'admin' ? (
          <p className="text-sm text-ink-3">{t('profile.admin_password_notice')}</p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3.5">
            <div>
              <Label htmlFor="old-pw">{t('profile.old_password')}</Label>
              <Input id="old-pw" type="password" className="mt-1.5" {...register('old_password')} />
              {errors.old_password && (
                <p className="text-xs text-alarm mt-1">{errors.old_password.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="new-pw">{t('profile.new_password')}</Label>
              <Input id="new-pw" type="password" className="mt-1.5" {...register('new_password')} />
              {errors.new_password && (
                <p className="text-xs text-alarm mt-1">{errors.new_password.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="confirm-pw">{t('profile.confirm_password')}</Label>
              <Input id="confirm-pw" type="password" className="mt-1.5" {...register('confirm_password')} />
              {errors.confirm_password && (
                <p className="text-xs text-alarm mt-1">{errors.confirm_password.message}</p>
              )}
            </div>
            <div className="flex justify-end mt-1">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('common.saving') : t('profile.save_password')}
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* ── last logins ── */}
      <div className="bg-surface border border-line rounded-md p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} className="text-ink-3" />
          <h2 className="text-sm font-semibold text-ink-1">{t('profile.last_logins')}</h2>
        </div>

        {lastLogins === null ? (
          <p className="text-sm text-ink-4">{t('common.loading')}</p>
        ) : lastLogins.length === 0 ? (
          <p className="text-sm text-ink-3">{t('profile.no_logins')}</p>
        ) : (
          <ul className="flex flex-col">
            {[...lastLogins].reverse().map((ts, i) => (
              <li
                key={i}
                className="flex items-center gap-2.5 py-2.5 border-b border-line last:border-0"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                <span className="text-sm text-ink-2">{formatLoginTs(ts, i18n.language)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  )
}
