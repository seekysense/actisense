import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => apiFetch('/api/config'),
    staleTime: 5 * 60 * 1000,
  })
}
