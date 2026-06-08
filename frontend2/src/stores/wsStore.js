import { create } from 'zustand'

export const useWsStore = create((set, get) => ({
  status: 'disconnected',
  heartbeat: null,
  alerts: [],
  engineEvents: [],

  setStatus: (status) => set({ status }),
  setHeartbeat: (data) => set({ heartbeat: data }),
  addAlert: (data) => set({ alerts: [data, ...get().alerts].slice(0, 100) }),
  addEngineEvent: (data) => set({ engineEvents: [data, ...get().engineEvents].slice(0, 200) }),
  clearAlerts: () => set({ alerts: [] }),
  clearEngineEvents: () => set({ engineEvents: [] }),
}))
