import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  List,
  FileText,
  Settings2,
  Video,
  Waypoints,
  SlidersHorizontal,
  Terminal,
  ChevronRight,
  ChevronDown,
  Building2,
  BoxSelect,
  BotMessageSquare,
} from 'lucide-react'
import Logo from '@/components/iqframe/Logo'
import StatusDot from '@/components/iqframe/StatusDot'
import { useAuthStore } from '@/stores/authStore'
import { useWsStore } from '@/stores/wsStore'
import { useConfig } from '@/hooks/useConfig'

function NavItem({ to, icon: Icon, label, active, child, onClick }) {
  return (
    <button
      onClick={() => onClick(to)}
      className={`flex items-center gap-2.5 w-full text-left text-[13.5px] font-medium rounded-md transition cursor-pointer ${
        active ? 'bg-bg-2 text-ink font-semibold' : 'text-ink-2 hover:bg-bg'
      } ${child ? 'py-2 pl-3.5 pr-3' : 'py-2.5 px-3'}`}
    >
      <Icon
        size={child ? 18 : 20}
        strokeWidth={1.75}
        className={active ? 'text-ink' : 'text-ink-3'}
      />
      <span className="flex-1">{label}</span>
    </button>
  )
}

export default function Sidebar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { logout, role } = useAuthStore()
  const isAdmin = role === 'admin'
  const wsStatus = useWsStore((s) => s.status)
  const { data: config } = useConfig()

  const route = location.pathname

  const areas = config?.areas || []
  const cameras = config?.cameras || []
  const siteName = config?.site?.name || 'IQFrame'

  const setupOpen = route.startsWith('/setup') || route === '/config'

  function handleNav(path) {
    if (path === 'logout') {
      logout()
      navigate('/login')
      return
    }
    navigate('/' + path)
  }

  function isActive(path) {
    if (path === '') return route === '/'
    return route === '/' + path || route.startsWith('/' + path + '/')
  }

  return (
    <aside className="w-[272px] h-screen bg-surface border-r border-line flex flex-col flex-shrink-0">
      {/* Brand / site block */}
      <div
        className="flex items-center h-16 px-4 border-b border-line/50 flex-shrink-0"
        style={{ backgroundImage: 'linear-gradient(to right, rgba(24, 24, 27, 0.05), rgba(0, 0, 0, 0))' }}
      >
        <Logo size={26} />
      </div>
      <div className="px-4 pt-3.5 pb-3.5">
        <div className="border border-line rounded-md p-3 bg-bg">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-1.5">
            {t('common.active_site')}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Building2 size={18} className="text-accent flex-shrink-0" />
              <span className="text-sm font-bold tracking-tight truncate">
                {siteName}
              </span>
            </div>
            <ChevronDown size={16} className="text-ink-4 flex-shrink-0" />
          </div>
          <div className="flex items-center gap-3.5 mt-2">
            <span className="text-[11.5px] text-ink-3 inline-flex items-center gap-1">
              <BoxSelect size={14} />
              {areas.length} {t('common.areas')}
            </span>
            <span className="text-[11.5px] text-ink-3 inline-flex items-center gap-1">
              <Video size={14} />
              {cameras.length} {t('common.cameras')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-line">
            <StatusDot
              sev={
                wsStatus === 'connected'
                  ? 'ok'
                  : wsStatus === 'connecting'
                    ? 'notify'
                    : 'offline'
              }
              size={7}
              pulse={wsStatus !== 'disconnected'}
            />
            <span
              className="text-[11.5px] font-semibold font-mono"
              style={{
                color:
                  wsStatus === 'connected'
                    ? 'var(--ok)'
                    : wsStatus === 'connecting'
                      ? 'var(--sev-notify)'
                      : 'var(--sev-offline)',
              }}
            >
              {wsStatus}
            </span>
            <span className="text-[11px] text-ink-4 ml-auto">websocket</span>
          </div>
        </div>
      </div>

      {/* Nav + filters scroll region */}
      <div className="flex-1 overflow-y-auto px-3">
        <nav className="flex flex-col gap-0.5">
          <NavItem
            to=""
            icon={LayoutDashboard}
            label={t('nav.dashboard')}
            active={isActive('')}
            onClick={handleNav}
          />
          <NavItem
            to="events"
            icon={List}
            label={t('nav.events')}
            active={isActive('events')}
            onClick={handleNav}
          />
          <NavItem
            to="config"
            icon={FileText}
            label={t('nav.config')}
            active={isActive('config')}
            onClick={handleNav}
          />

          {/* Setup accordion — admin only */}
          {isAdmin && (
            <>
              <button
                onClick={() => handleNav('setup')}
                className={`flex items-center gap-2.5 w-full text-left text-[13.5px] font-medium rounded-md transition cursor-pointer py-2.5 px-3 ${
                  isActive('setup')
                    ? 'bg-bg-2 text-ink font-semibold'
                    : 'text-ink-2 hover:bg-bg'
                }`}
              >
                <Settings2
                  size={20}
                  strokeWidth={1.75}
                  className={isActive('setup') ? 'text-ink' : 'text-ink-3'}
                />
                <span className="flex-1">{t('nav.setup')}</span>
                {setupOpen ? (
                  <ChevronDown size={16} className="text-ink-4" />
                ) : (
                  <ChevronRight size={16} className="text-ink-4" />
                )}
              </button>
              {setupOpen && (
                <div className="flex flex-col gap-0.5 ml-3.5 pl-2 border-l border-line">
                  <NavItem
                    to="setup/cameras"
                    icon={Video}
                    label={t('setup.cameras')}
                    active={isActive('setup/cameras')}
                    child
                    onClick={handleNav}
                  />
                  <NavItem
                    to="setup/signals"
                    icon={Waypoints}
                    label={t('setup.signals')}
                    active={isActive('setup/signals')}
                    child
                    onClick={handleNav}
                  />
                  <NavItem
                    to="setup/site"
                    icon={SlidersHorizontal}
                    label={t('setup.site')}
                    active={isActive('setup/site')}
                    child
                    onClick={handleNav}
                  />
                  <NavItem
                    to="setup/prompts"
                    icon={BotMessageSquare}
                    label={t('setup.prompts')}
                    active={isActive('setup/prompts')}
                    child
                    onClick={handleNav}
                  />
                </div>
              )}
            </>
          )}

          <NavItem
            to="logs"
            icon={Terminal}
            label={t('nav.logs')}
            active={isActive('logs')}
            onClick={handleNav}
          />
        </nav>

      </div>

      {/* Footer: ia-logo */}
      <div className="border-t border-line p-3">
        <div className="px-2.5 py-2">
          <img src="/ia-logo.png" alt="Infinite Automation" className="w-full h-auto object-contain" style={{ maxHeight: 32 }} />
        </div>
      </div>
    </aside>
  )
}
