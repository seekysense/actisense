import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { User, Lock } from 'lucide-react'

export default function Login() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: new URLSearchParams({ username, password }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      if (data?.access_token) {
        login(data.access_token, data.role || 'user', data.username || username)
        navigate('/')
      } else {
        setError(t('auth.error'))
      }
    } catch {
      setError(t('auth.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg">
      <img src="/logo.svg" alt="IQFrame" className="h-10 mb-6" />
      <div className="w-full max-w-[380px] bg-surface rounded-lg shadow-lg p-6 border border-line">
        <h1 className="text-xl font-semibold mb-1">{t('auth.sign_in')}</h1>
        <p className="text-sm text-ink-3 mb-4">{t('auth.subtitle', { site: 'IQFrame' })}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="username">{t('auth.username')}</Label>
            <div className="relative mt-1.5">
              <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="pl-10"
                required
              />
            </div>
          </div>
          <div>
            <Label htmlFor="password">{t('auth.password')}</Label>
            <div className="relative mt-1.5">
              <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10"
                required
              />
            </div>
          </div>
          {error && <p className="text-sm text-alarm">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('auth.signing_in') : t('auth.sign_in')}
          </Button>
          <p className="text-center">
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="text-sm text-ink-3 hover:text-ink-2 transition"
            >
              {t('auth.forgot_password')}
            </a>
          </p>
        </form>
      </div>
      <p className="mt-6 text-sm text-ink-3">IQFrame · semantic video surveillance</p>
    </div>
  )
}
