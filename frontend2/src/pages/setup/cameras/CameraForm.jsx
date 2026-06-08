import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useConfig } from '@/hooks/useConfig'
import { useAuthStore } from '@/stores/authStore'
import { apiFetch } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

export default function CameraForm() {
  const { t } = useTranslation()
  const schema = z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1, t('setup.display_name_required')),
    area: z.string().min(1),
    axis_ip: z.union([z.literal(''), z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, t('setup.invalid_ipv4'))]),
    axis_event_id: z.string().optional(),
    people_counting: z.boolean(),
  })
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const isAdmin = useAuthStore((s) => s.role) === 'admin'
  const { data: config, refetch } = useConfig()
  const cameras = config?.cameras || []
  const areas = config?.areas || []
  const existing = cameras.find((c) => c.id === id)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      id: '',
      name: '',
      area: areas[0]?.id || '',
      axis_ip: '',
      axis_event_id: '',
      people_counting: false,
    },
  })

  useEffect(() => {
    if (existing) {
      setValue('name', existing.name || '')
      setValue('area', existing.area || '')
      setValue('axis_ip', existing.axis_ip || '')
      setValue('axis_event_id', existing.axis_event_id || '')
      setValue('people_counting', existing.native_analytics?.people_counting || false)
    }
  }, [existing, setValue])

  const peopleCounting = watch('people_counting')

  async function onSubmit(data) {
    if (!isAdmin) return
    const payload = {
      name: data.name,
      area: data.area,
      axis_ip: data.axis_ip || undefined,
      axis_event_id: data.axis_event_id || undefined,
      native_analytics: { people_counting: data.people_counting },
      preprocessing: { roi: { enabled: false, zones: [] } },
    }
    try {
      if (isEdit) {
        await apiFetch(`/api/config/cameras/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
        toast.success(t('setup.changes_saved'))
        navigate('/setup/cameras')
      } else {
        const newCam = { ...payload, id: data.id }
        await apiFetch('/api/config/cameras', {
          method: 'POST',
          body: JSON.stringify(newCam),
        })
        toast.success(t('setup.camera_created'))
        navigate(`/setup/cameras/${data.id}/roi`)
      }
      refetch()
    } catch (e) {
      toast.error(e.message || t('errors.saving'))
    }
  }

  return (
    <div className="max-w-[620px]">
      <div className="mb-5">
        <h1 className="text-[27px] font-bold tracking-tight text-ink">
          {isEdit ? existing?.name || t('setup.edit') : t('setup.new_camera')}
        </h1>
      </div>

      {!isAdmin && (
        <div className="mb-4 p-3 bg-accent-soft border border-accent rounded-md text-sm text-accent-ink flex items-center gap-2">
          {t('setup.readonly_notice')}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        {!isEdit && (
          <div>
            <Label htmlFor="cam-id">{t('setup.camera_id')}</Label>
            <Input
              id="cam-id"
              {...register('id')}
              placeholder="cam_kitchen_01"
              className="font-mono"
              disabled={!isAdmin}
            />
            <p className="text-[11.5px] text-ink-4 mt-1">{t('setup.camera_id_hint')}</p>
          </div>
        )}

        <div>
          <Label htmlFor="cam-name">Display name</Label>
          <Input
            id="cam-name"
            {...register('name')}
            placeholder="Ager Patris Lounge"
            disabled={!isAdmin}
          />
          {errors.name && <p className="text-xs text-alarm mt-1">{errors.name.message}</p>}
        </div>

        <div>
          <Label>{t('dashboard.areas')}</Label>
          <Select
            value={watch('area')}
            onValueChange={(v) => setValue('area', v)}
            disabled={!isAdmin || isEdit}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {areas.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="cam-ip">{t('setup.axis_ip')}</Label>
            <Input
              id="cam-ip"
              {...register('axis_ip')}
              placeholder="10.46.67.5"
              className="font-mono"
              disabled={!isAdmin}
            />
            {errors.axis_ip && <p className="text-xs text-alarm mt-1">{errors.axis_ip.message}</p>}
            <p className="text-[11.5px] text-ink-4 mt-1">{t('setup.axis_ip_desc')}</p>
          </div>
          <div>
            <Label htmlFor="cam-event">{t('setup.axis_event_id')}</Label>
            <Input
              id="cam-event"
              {...register('axis_event_id')}
              placeholder="cabinet"
              className="font-mono"
              disabled={!isAdmin}
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-3.5 py-3 bg-bg-2 rounded-md">
          <div>
            <div className="text-[13px] font-semibold text-ink-1">{t('setup.people_counting')}</div>
            <div className="text-[11.5px] text-ink-3 mt-0.5">
              {t('setup.people_counting_desc')}
            </div>
          </div>
          <Switch
            checked={peopleCounting}
            onCheckedChange={(v) => setValue('people_counting', v)}
            disabled={!isAdmin}
          />
        </div>

        <div className="flex justify-end gap-2.5 mt-2">
          <Button type="button" variant="outline" onClick={() => navigate('/setup/cameras')}>
            {t('setup.cancel')}
          </Button>
          {isAdmin && (
            <Button type="submit">
              {isEdit ? t('setup.save') : t('setup.save_and_roi')}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
