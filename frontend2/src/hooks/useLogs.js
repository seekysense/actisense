import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

export function useLogs(kind = null) {
  const url = kind ? `/api/logs?kind=${encodeURIComponent(kind)}` : '/api/logs'
  return useQuery({
    queryKey: ['logs', kind],
    queryFn: () => apiFetch(url),
    refetchInterval: 10000,
  })
}
