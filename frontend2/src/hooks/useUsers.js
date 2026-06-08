import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

const USERS_KEY = ['users']

export function useUsers() {
  return useQuery({
    queryKey: USERS_KEY,
    queryFn: () => apiFetch('/api/users'),
    staleTime: 30 * 1000,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => apiFetch('/api/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (email) => apiFetch(`/api/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  })
}

export function useSetUserPassword() {
  return useMutation({
    mutationFn: ({ email, password }) =>
      apiFetch(`/api/users/${encodeURIComponent(email)}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password }),
      }),
  })
}
