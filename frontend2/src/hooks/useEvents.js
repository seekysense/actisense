import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

export function useEvents({ date, dateFrom, dateTo } = {}) {
  const params = new URLSearchParams()
  if (date) {
    params.set('date_from', date)
    params.set('date_to', date)
  }
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  const qs = params.toString()
  return useQuery({
    queryKey: ['events', date, dateFrom, dateTo],
    queryFn: () => apiFetch(`/api/events${qs ? '?' + qs : ''}`),
    staleTime: 30 * 1000,
  })
}
