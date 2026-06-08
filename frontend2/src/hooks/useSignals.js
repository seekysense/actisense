import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

const SIGNALS_KEY = ['signals']

export function usePrompts() {
  return useQuery({
    queryKey: ['prompts'],
    queryFn: () => apiFetch('/api/config/prompts'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreatePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => apiFetch('/api/config/prompts', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  })
}

export function useDeletePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key) => apiFetch(`/api/config/prompts/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  })
}

export function useSignals() {
  return useQuery({
    queryKey: SIGNALS_KEY,
    queryFn: () => apiFetch('/api/config/signals'),
    staleTime: 30 * 1000,
  })
}

export function useSignalDetail(id) {
  return useQuery({
    queryKey: ['signal', id],
    queryFn: () => apiFetch(`/api/config/signals/${id}`),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateSignal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => apiFetch('/api/config/signals', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SIGNALS_KEY })
      qc.invalidateQueries({ queryKey: ['config'] })
    },
  })
}

export function useUpdateSignal(id) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => apiFetch(`/api/config/signals/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SIGNALS_KEY })
      qc.invalidateQueries({ queryKey: ['signal', id] })
      qc.invalidateQueries({ queryKey: ['config'] })
    },
  })
}

export function useDeleteSignal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => apiFetch(`/api/config/signals/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SIGNALS_KEY })
      qc.invalidateQueries({ queryKey: ['config'] })
    },
  })
}
