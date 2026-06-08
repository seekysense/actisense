import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

export function useLiveStatus() {
  return useQuery({
    queryKey: ['live/status'],
    queryFn: () => apiFetch('/api/live/status'),
    refetchInterval: 5000,
    staleTime: 3000,
  })
}
