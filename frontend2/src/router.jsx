import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import AppLayout from '@/components/shell/AppLayout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Events from '@/pages/Events'
import Config from '@/pages/Config'
import Logs from '@/pages/Logs'
import SetupLanding from '@/pages/setup/SetupLanding'
import CameraList from '@/pages/setup/cameras/CameraList'
import CameraForm from '@/pages/setup/cameras/CameraForm'
import RoiEditor from '@/pages/setup/cameras/RoiEditor'
import SignalList from '@/pages/setup/signals/SignalList'
import SignalWizard from '@/pages/setup/signals/SignalWizard'
import SignalEditForm from '@/pages/setup/signals/SignalEditForm'
import SiteSettings from '@/pages/setup/SiteSettings'
import PromptList from '@/pages/setup/prompts/PromptList'
import UserList from '@/pages/setup/users/UserList'
import DevUI from '@/pages/DevUI'
import Profile from '@/pages/Profile'

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return children
}

function RequireAdmin({ children }) {
  const role = useAuthStore((s) => s.role)
  if (role !== 'admin') return <Navigate to="/" replace />
  return children
}

export const router = createBrowserRouter([
  {
    path: '/dev-ui',
    element: <DevUI />,
  },
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'events', element: <Events /> },
      { path: 'config', element: <Config /> },
      { path: 'logs', element: <Logs /> },
      { path: 'profile', element: <Profile /> },
      {
        path: 'setup',
        element: (
          <RequireAdmin>
            <Outlet />
          </RequireAdmin>
        ),
        children: [
          { index: true, element: <SetupLanding /> },
          { path: 'cameras', element: <CameraList /> },
          { path: 'cameras/new', element: <CameraForm /> },
          { path: 'cameras/:id/edit', element: <CameraForm /> },
          { path: 'cameras/:id/roi', element: <RoiEditor /> },
          { path: 'signals', element: <SignalList /> },
          { path: 'signals/new', element: <SignalWizard /> },
          { path: 'signals/:id/edit', element: <SignalEditForm /> },
          { path: 'site', element: <SiteSettings /> },
          { path: 'prompts', element: <PromptList /> },
          { path: 'users', element: <UserList /> },
        ],
      },
    ],
  },
])
