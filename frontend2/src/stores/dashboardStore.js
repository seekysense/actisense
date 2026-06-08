import { create } from 'zustand'

export const useDashboardStore = create((set) => ({
  dateView: 'day',
  selectedDate: new Date().toISOString().slice(0, 10),
  filters: {
    areas: new Set(),
    priorities: new Set(),
    actions: new Set(),
  },
  toggleFilter: (key, val) =>
    set((state) => {
      const next = new Set(state.filters[key])
      next.has(val) ? next.delete(val) : next.add(val)
      return { filters: { ...state.filters, [key]: next } }
    }),
  resetFilters: () =>
    set({
      filters: { areas: new Set(), priorities: new Set(), actions: new Set() },
    }),
  setDateView: (view) => set({ dateView: view }),
  setSelectedDate: (date) => set({ selectedDate: date }),
}))
