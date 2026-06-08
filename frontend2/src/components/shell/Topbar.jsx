import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, Bell, ChevronDown, User, LogOut, X } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useWsStore } from '@/stores/wsStore'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useSmartSearchStore } from '@/stores/smartSearchStore'
import { useSmartSearch } from '@/hooks/useSmartSearch'
import StatusDot from '@/components/iqframe/StatusDot'
import LivePanel from '@/components/dashboard/LivePanel'
import { initials } from '@/lib/utils'

const LANG_FLAGS = { it: '🇮🇹', en: '🇬🇧' }

function LanguageFlag({ lang }) {
  return (
    <span style={{ fontFamily: 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif', fontSize: 16, lineHeight: 1 }}>
      {LANG_FLAGS[lang] ?? '🌐'}
    </span>
  )
}

export default function Topbar() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { username, role, logout } = useAuthStore()
  const wsStatus = useWsStore((s) => s.status)
  const alerts = useWsStore((s) => s.alerts)
  const selectedDate = useDashboardStore((s) => s.selectedDate)

  const isActive = useSmartSearchStore((s) => s.isActive)
  const clearResults = useSmartSearchStore((s) => s.clearResults)
  const setResults = useSmartSearchStore((s) => s.setResults)
  const smartSearch = useSmartSearch()

  const [searchText, setSearchText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [liveOpen, setLiveOpen] = useState(false)
  const menuRef = useRef(null)
  const langRef = useRef(null)

  const isDashboard = location.pathname === '/'
  const isToday = selectedDate === new Date().toISOString().slice(0, 10)
  const showLive = isDashboard && isToday
  const notifCount = alerts.length
  const isPending = smartSearch.isPending

  useEffect(() => {
    if (!menuOpen && !langOpen) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
      if (langRef.current && !langRef.current.contains(e.target)) setLangOpen(false)
    }
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        setLangOpen(false)
      }
    }
    window.addEventListener('mousedown', handler)
    window.addEventListener('keydown', keyHandler)
    return () => {
      window.removeEventListener('mousedown', handler)
      window.removeEventListener('keydown', keyHandler)
    }
  }, [menuOpen, langOpen])

  function changeLanguage(lang) {
    i18n.changeLanguage(lang)
    localStorage.setItem('iqframe_lang', lang)
    setLangOpen(false)
  }

  function handleLogout() {
    logout()
    navigate('/login')
  }

  function handleSearch(e) {
    if (e.key !== 'Enter') return
    const q = searchText.trim()
    if (!q || isPending) return

    smartSearch.mutate(q, {
      onSuccess: (data) => {
        setResults(data)
        setSearchText('')
        navigate('/events')
      },
      onError: () => {
        // non-blocking: lo store resta com'è, l'utente può riprovare
      },
    })
  }

  function handleClear() {
    clearResults()
    setSearchText('')
  }

  const searchBorderClass = isActive
    ? 'border-accent ring-2 ring-accent/20'
    : 'border-line-2 focus-within:ring-2 focus-within:ring-accent/20 focus-within:border-accent'

  const placeholder = isPending
    ? t('topbar.search_loading')
    : t('topbar.search_placeholder')

  return (
    <header className="h-16 px-6 border-b border-line bg-surface flex items-center gap-4 flex-shrink-0">
      {/* Search */}
      <div className="flex-1 max-w-[560px]">
        <div className={`relative flex items-center rounded-md border bg-bg transition ${searchBorderClass}`}>
          {/* Left icon: spinner or search */}
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink-4">
            {isPending ? (
              <span className="block w-[18px] h-[18px] border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            ) : (
              <Search size={18} />
            )}
          </span>

          <input
            type="text"
            placeholder={placeholder}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={handleSearch}
            disabled={isPending}
            className="w-full h-10 pl-10 pr-8 text-sm text-ink outline-none bg-transparent transition disabled:opacity-60 disabled:cursor-not-allowed"
          />

          {/* Right: × to clear active search, or × to clear typed text */}
          {isActive && !isPending && (
            <button
              onClick={handleClear}
              title={t('topbar.search_clear')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-sm text-ink-3 hover:text-ink-1 hover:bg-bg-2 transition cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* "Ricerca attiva" badge — shown below the input when isActive */}
        {isActive && !isPending && (
          <div className="mt-1 px-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
            <span className="text-[11px] text-accent font-medium">{t('topbar.search_active')}</span>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {showLive && (
        <button
          onClick={() => setLiveOpen(true)}
          className="h-[38px] px-3.5 rounded-sm border border-line bg-surface inline-flex items-center gap-2 cursor-pointer text-[13px] font-semibold text-ink-1 hover:bg-bg-2 transition"
        >
          <StatusDot sev={wsStatus === 'connected' ? 'ok' : wsStatus === 'connecting' ? 'notify' : 'offline'} size={8} pulse={wsStatus !== 'disconnected'} />
          {t('dashboard.live')}
        </button>
      )}

      {liveOpen && <LivePanel open={liveOpen} onClose={() => setLiveOpen(false)} />}

      {/* Language selector */}
      <div ref={langRef} className="relative">
        <button
          onClick={() => setLangOpen((o) => !o)}
          className="h-9 px-2.5 border-0 bg-transparent inline-flex items-center gap-1.5 cursor-pointer text-[13px] text-ink-1 rounded-lg hover:bg-bg-2 transition"
        >
          <LanguageFlag lang={i18n.language} />
          <span className="font-medium">{i18n.language.toUpperCase()}</span>
          <ChevronDown size={14} className="text-ink-4" />
        </button>
        {langOpen && (
          <div className="absolute top-[calc(100%+8px)] right-0 w-40 bg-surface border border-line rounded-md shadow-lg p-1.5 z-[200] animate-in fade-in duration-150">
            <button
              onClick={() => changeLanguage('it')}
              className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-sm text-left text-sm hover:bg-bg-2 transition"
            >
              <LanguageFlag lang="it" />
              <span>{t('common.italian')}</span>
            </button>
            <button
              onClick={() => changeLanguage('en')}
              className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-sm text-left text-sm hover:bg-bg-2 transition"
            >
              <LanguageFlag lang="en" />
              <span>{t('common.english')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Notifications */}
      <button className="w-10 h-10 rounded-full border-0 bg-transparent flex items-center justify-center relative text-ink-2 hover:bg-bg-2 transition cursor-pointer">
        <Bell size={20} strokeWidth={1.75} />
        {notifCount > 0 && (
          <span className="absolute top-1.5 right-2 min-w-[8px] h-[8px] rounded-full bg-alarm shadow-[0_0_0_2px_var(--surface)]" />
        )}
      </button>

      <div className="w-px h-7 bg-line" />

      {/* User menu */}
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-md border-0 cursor-pointer transition bg-transparent hover:bg-bg"
        >
          <div className="w-[38px] h-[38px] rounded-full bg-ink text-white flex items-center justify-center text-[13px] font-semibold flex-shrink-0">
            {initials(username)}
          </div>
          <div className="leading-tight text-left hidden sm:block">
            <div className="text-[13.5px] font-semibold text-ink-1">{username}</div>
            <div className="text-xs text-ink-3 capitalize">{role}</div>
          </div>
          <ChevronDown size={16} className="text-ink-4 ml-0.5" />
        </button>

        {menuOpen && (
          <div className="absolute top-[calc(100%+8px)] right-0 w-64 bg-surface border border-line rounded-md shadow-lg p-1.5 z-[200] animate-in fade-in duration-150">
            <div className="px-2.5 pt-2 pb-3 border-b border-line mb-1.5">
              <div className="text-[13.5px] font-semibold text-ink-1">{username}</div>
              <div className="text-xs text-ink-3 capitalize">{role}</div>
            </div>
            <button
              onClick={() => { setMenuOpen(false); navigate('/profile') }}
              className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-sm text-left text-sm hover:bg-bg-2 transition text-ink-2"
            >
              <User size={18} className="text-ink-3" strokeWidth={1.75} />
              {t('common.profile')}
            </button>
            <div className="h-px bg-line my-1.5" />
            <button onClick={handleLogout} className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-sm text-left text-sm hover:bg-alarm-bg transition text-alarm">
              <LogOut size={18} strokeWidth={1.75} />
              {t('common.logout')}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
