import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useConfig } from '@/hooks/useConfig'
import { useAuthStore } from '@/stores/authStore'
import { apiFetch } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export default function SiteSettings() {
  const { t } = useTranslation()
  const schema = z.object({
    site_name: z.string().min(1, t('setup.site_name_required')),
    timezone: z.string().min(1),
    default_language: z.enum(['it', 'en']),
    retention_days: z.coerce.number().min(1).max(365),
    notification_email: z.union([z.literal(''), z.string().email()]),
  })
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.role) === 'admin'
  const { data: config, refetch } = useConfig()
  const site = config?.site || {}

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      site_name: '',
      timezone: 'Europe/Rome',
      default_language: 'it',
      retention_days: 30,
      notification_email: '',
    },
  })

  useEffect(() => {
    if (site) {
      setValue('site_name', site.site_name || '')
      setValue('timezone', site.timezone || 'Europe/Rome')
      setValue('default_language', site.default_language || 'it')
      setValue('retention_days', site.retention_days || 30)
      setValue('notification_email', site.notification_email || '')
    }
  }, [site, setValue])

  async function onSubmit(data) {
    if (!isAdmin) return
    try {
      await apiFetch('/api/config', {
        method: 'PATCH',
        body: JSON.stringify({ site: data }),
      })
      toast.success(t('setup.site_saved'))
      refetch()
    } catch (e) {
      toast.error(e.message || t('errors.saving'))
    }
  }

  return (
    <div className="max-w-[620px]">
      <div className="mb-5">
        <h1 className="text-[27px] font-bold tracking-tight text-ink">{t('setup.site')}</h1>
        <p className="text-sm text-ink-3 mt-1">{t('setup.site_subtitle')}</p>
      </div>

      {!isAdmin && (
        <div className="mb-4 p-3 bg-accent-soft border border-accent rounded-md text-sm text-accent-ink flex items-center gap-2">
          {t('setup.readonly_notice')}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="ss-name">{t('setup.site_name')}</Label>
          <Input id="ss-name" {...register('site_name')} disabled={!isAdmin} />
          {errors.site_name && (
            <p className="text-xs text-alarm mt-1">{errors.site_name.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="ss-tz">{t('setup.timezone')}</Label>
          <Input id="ss-tz" {...register('timezone')} disabled={!isAdmin} />
        </div>

        <div>
          <Label htmlFor="ss-lang">{t('setup.default_language')}</Label>
          <select
            id="ss-lang"
            className="w-full h-9 px-2.5 rounded-sm border border-line bg-surface text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
            value={watch('default_language')}
            onChange={(e) => setValue('default_language', e.target.value)}
            disabled={!isAdmin}
          >
            <option value="it">{t('common.italian')}</option>
            <option value="en">{t('common.english')}</option>
          </select>
        </div>

        <div>
          <Label htmlFor="ss-ret">{t('setup.retention_days')}</Label>
          <Input
            id="ss-ret"
            type="number"
            min={1}
            max={365}
            {...register('retention_days')}
            disabled={!isAdmin}
          />
          {errors.retention_days && (
            <p className="text-xs text-alarm mt-1">{errors.retention_days.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="ss-email">{t('setup.notification_email')}</Label>
          <Input
            id="ss-email"
            type="email"
            {...register('notification_email')}
            disabled={!isAdmin}
          />
          {errors.notification_email && (
            <p className="text-xs text-alarm mt-1">{errors.notification_email.message}</p>
          )}
        </div>

        <div className="flex justify-end gap-2.5 mt-2">
          <Button type="button" variant="outline" onClick={() => navigate('/setup')}>
            {t('setup.cancel')}
          </Button>
          {isAdmin && <Button type="submit">{t('setup.save')}</Button>}
        </div>
      </form>
    </div>
  )
}
