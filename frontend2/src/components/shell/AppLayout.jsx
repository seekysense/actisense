import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { useWebSocket } from '@/hooks/useWebSocket'

export default function AppLayout() {
  useWebSocket()
  return (
    <div className="min-h-screen flex bg-bg text-ink">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
