import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useConfig } from '@/hooks/useConfig'
import { usePrompts } from '@/hooks/useSignals'
import { Video, Waypoints, SlidersHorizontal, Terminal, BotMessageSquare, Users } from 'lucide-react'
import SevCard from '@/components/iqframe/SevCard'
import ActionPill from '@/components/iqframe/ActionPill'

export default function SetupLanding() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: config } = useConfig()

  const cameras = config?.cameras || []
  const signals = config?.signals || []
  const { data: prompts = [] } = usePrompts()

  const cards = [
    {
      id: 'cameras',
      icon: Video,
      title: t('setup.cameras'),
      desc: t('setup.cameras_desc'),
      badge: t('setup.cameras_count', {count: cameras.length}),
      path: 'cameras',
    },
    {
      id: 'signals',
      icon: Waypoints,
      title: t('setup.signals'),
      desc: t('setup.signals_desc'),
      badge: t('setup.signals_count', {count: signals.length}),
      path: 'signals',
    },
    {
      id: 'site',
      icon: SlidersHorizontal,
      title: t('setup.site'),
      desc: t('setup.site_desc'),
      badge: null,
      path: 'site',
    },
    {
      id: 'prompts',
      icon: BotMessageSquare,
      title: t('setup.prompts'),
      desc: t('setup.prompts_desc'),
      badge: prompts.length > 0 ? t('setup.prompts_count', { count: prompts.length }) : null,
      path: 'prompts',
    },
    {
      id: 'users',
      icon: Users,
      title: t('setup.users'),
      desc: t('setup.users_desc'),
      badge: null,
      path: 'users',
    },
    {
      id: 'logs',
      icon: Terminal,
      title: t('setup.logs'),
      desc: t('setup.logs_desc'),
      badge: null,
      path: '/logs',
    },
  ]

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[27px] font-bold tracking-tight text-ink">{t('setup.title')}</h1>
        <p className="text-sm text-ink-3 mt-1">
          {t('setup.landing_subtitle')}
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {cards.map((c) => (
          <SevCard
            key={c.id}
            hover
            className="p-5 cursor-pointer"
            onClick={() => navigate(c.path.startsWith('/') ? c.path : `/setup/${c.path}`)}
          >
            <div className="w-11 h-11 rounded-md bg-accent-soft flex items-center justify-center mb-3.5">
              <c.icon size={24} className="text-accent" />
            </div>
            <div className="text-base font-bold tracking-tight mb-1">{c.title}</div>
            <p className="text-[13px] text-ink-3 leading-relaxed m-0">{c.desc}</p>
            {c.badge && (
              <div className="mt-3">
                <ActionPill action="statistic">{c.badge}</ActionPill>
              </div>
            )}
          </SevCard>
        ))}
      </div>
    </div>
  )
}
