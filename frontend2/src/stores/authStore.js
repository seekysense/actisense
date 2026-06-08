import { create } from 'zustand'

export const useAuthStore = create((set) => ({
  token: localStorage.getItem('vsa_token') || null,
  role: localStorage.getItem('vsa_role') || null,
  username: localStorage.getItem('vsa_username') || null,

  login(token, role, username) {
    localStorage.setItem('vsa_token', token)
    localStorage.setItem('vsa_role', role)
    localStorage.setItem('vsa_username', username)
    set({ token, role, username })
  },

  logout() {
    localStorage.removeItem('vsa_token')
    localStorage.removeItem('vsa_role')
    localStorage.removeItem('vsa_username')
    set({ token: null, role: null, username: null })
  },
}))
