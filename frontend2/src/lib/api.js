import { useAuthStore } from '@/stores/authStore'

const BASE = import.meta.env.VITE_API_URL || ''

export async function apiFetch(path, options = {}) {
  const token = useAuthStore.getState().token
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (res.status === 401) {
    useAuthStore.getState().logout()
    window.location.href = '/login'
    return
  }
  if (!res.ok) throw new Error(await res.text())
  if (res.status === 204) return null
  return res.json()
}
