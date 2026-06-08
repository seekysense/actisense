import { create } from 'zustand'

export const useSmartSearchStore = create((set) => ({
  isActive: false,
  query: '',
  results: [],
  filters: {},
  confidence: null,
  originalIntent: '',

  setResults: (data) =>
    set({
      isActive: true,
      query: data.query ?? '',
      results: data.events ?? [],
      filters: data.filters ?? {},
      confidence: data.confidence ?? null,
      originalIntent: data.original_intent ?? '',
    }),

  clearResults: () =>
    set({
      isActive: false,
      query: '',
      results: [],
      filters: {},
      confidence: null,
      originalIntent: '',
    }),
}))
