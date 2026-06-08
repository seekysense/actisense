import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

export function useSmartSearch() {
  return useMutation({
    mutationFn: (query) =>
      apiFetch('/api/events/search', {
        method: 'POST',
        body: JSON.stringify({ q: query }),
      }),
  })
}
