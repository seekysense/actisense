import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useWsStore } from '@/stores/wsStore'

const WS_BASE = import.meta.env.VITE_WS_URL || (() => {
  const { protocol, host } = window.location
  return (protocol === 'https:' ? 'wss:' : 'ws:') + '//' + host
})()

export function useWebSocket() {
  const token = useAuthStore((s) => s.token)
  const setStatus = useWsStore((s) => s.setStatus)
  const setHeartbeat = useWsStore((s) => s.setHeartbeat)
  const addAlert = useWsStore((s) => s.addAlert)
  const addEngineEvent = useWsStore((s) => s.addEngineEvent)
  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const reconnectDelayRef = useRef(1000)

  useEffect(() => {
    if (!token) return

    function connect() {
      setStatus('connecting')
      const url = `${WS_BASE}/api/ws?token=${token}`
      const ws = new WebSocket(url)

      ws.onopen = () => {
        setStatus('connected')
        reconnectDelayRef.current = 1000
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          switch (msg.type) {
            case 'alert':
              addAlert(msg.data)
              break
            case 'engine_heartbeat':
              setHeartbeat(msg.data)
              break
            case 'engine_event':
              addEngineEvent(msg.data)
              break
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        setStatus('disconnected')
        scheduleReconnect()
      }

      ws.onerror = () => {
        ws.close()
      }

      wsRef.current = ws
    }

    function scheduleReconnect() {
      const delay = Math.min(reconnectDelayRef.current, 30000)
      reconnectDelayRef.current *= 2
      reconnectTimeoutRef.current = setTimeout(connect, delay)
    }

    connect()

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [token, setStatus, setHeartbeat, addAlert, addEngineEvent])
}
