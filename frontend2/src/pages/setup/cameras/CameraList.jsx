import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Video, Network, Scan, Zap, Users, Pencil, Crop, Info } from 'lucide-react'
import { useConfig } from '@/hooks/useConfig'
import { useAuthStore } from '@/stores/authStore'
import { apiFetch } from '@/lib/api'
import SevCard from '@/components/iqframe/SevCard'
import ActionPill from '@/components/iqframe/ActionPill'
import ConfirmDelete from '@/components/iqframe/ConfirmDelete'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export default function CameraList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: config, refetch } = useConfig()
  const isAdmin = useAuthStore((s) => s.role) === 'admin'

  const cameras = config?.cameras || []
  const areas = config?.areas || []
  const areaMap = Object.fromEntries(areas.map((a) => [a.id, a.name]))

  async function handleDelete(cam) {
    try {
      await apiFetch(`/api/config/cameras/${cam.id}`, { method: 'DELETE' })
      toast.success(`Camera ${cam.id} deleted`)
      refetch()
    } catch (e) {
      toast.error(e.message || 'Delete failed')
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[27px] font-bold tracking-tight text-ink">
            {t('setup.cameras')} · {cameras.length}
          </h1>
          <p className="text-sm text-ink-3 mt-1">{t('setup.cameras_desc')}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => navigate('/setup/cameras/new')}>
            <Video size={16} className="mr-1.5" />
            {t('setup.add_camera')}
          </Button>
        )}
      </div>

      {!isAdmin && (
        <div className="mb-4 p-3 bg-accent-soft border border-accent rounded-md text-sm text-accent-ink flex items-center gap-2">
          <Info size={16} />
          {t('setup.readonly_notice')}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {cameras.map((cam) => {
          const zones = cam.preprocessing?.roi?.zones || []
          return (
            <SevCard key={cam.id} className="px-4 py-4 flex items-center gap-4">
              <div className="w-11 h-11 rounded-md bg-bg-2 flex items-center justify-center flex-shrink-0">
                <Video size={22} className="text-ink-3" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="font-mono text-[13px] font-semibold text-ink-1">{cam.id}</span>
                  {cam.axis_ip && (
                    <ActionPill action="statistic" dot>
                      <Network size={12} className="mr-1" />
                      IP {cam.axis_ip}
                    </ActionPill>
                  )}
                  <ActionPill action="ok" dot>
                    {areaMap[cam.area] || cam.area}
                  </ActionPill>
                </div>
                <div className="text-[13.5px] font-semibold text-ink">{cam.name}</div>
                <div className="flex gap-3.5 mt-1.5 text-[11.5px] text-ink-3">
                  <span className="inline-flex items-center gap-1">
                    <Scan size={14} />
                    {zones.length} {t('setup.zones')}
                  </span>
                  {cam.axis_event_id && (
                    <span className="inline-flex items-center gap-1">
                      <Zap size={14} />
                      {t('setup.event_label')}: <span className="font-mono">{cam.axis_event_id}</span>
                    </span>
                  )}
                  {cam.native_analytics?.people_counting && (
                    <span className="inline-flex items-center gap-1">
                      <Users size={14} />
                      {t('setup.people_counting_short')}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => navigate(`/setup/cameras/${cam.id}/roi`)}
                >
                  <Crop size={14} />
                  {t('setup.roi_editor')}
                </Button>
                {isAdmin && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-8 h-8 p-0"
                      onClick={() => navigate(`/setup/cameras/${cam.id}/edit`)}
                    >
                      <Pencil size={16} />
                    </Button>
                    <ConfirmDelete onConfirm={() => handleDelete(cam)} />
                  </>
                )}
              </div>
            </SevCard>
          )
        })}
      </div>
    </div>
  )
}
