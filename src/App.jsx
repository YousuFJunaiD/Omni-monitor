import {Suspense, lazy} from 'react'
import {BrowserRouter, Navigate, Route, Routes, useLocation} from 'react-router-dom'
import {NotifyProvider} from './lib/notify'
import {ThemeProvider} from './lib/theme'
import {useAuth} from './context/AuthContext'
import {DashboardProvider} from './context/DashboardContext'
import AppShell from './layouts/AppShell'
import RoleGuard from './components/RoleGuard'

const LoginScreen = lazy(() => import('./screens/LoginScreen'))
const HomeScreen = lazy(() => import('./screens/HomeScreen'))
const TasksScreen = lazy(() => import('./screens/TasksScreen'))
const IdeasScreen = lazy(() => import('./screens/IdeasScreen'))
const TeamScreen = lazy(() => import('./screens/TeamScreen'))
const MoreScreen = lazy(() => import('./screens/MoreScreen'))
const ProfileScreen = lazy(() => import('./screens/ProfileScreen'))
const ReportsScreen = lazy(() => import('./screens/ReportsScreen'))

function RouteFallback() {
  return <div className="route-fallback" aria-label="Loading screen" />
}

function ProtectedRoute({children}) {
  const { isAuthenticated, isAuthLoading } = useAuth()
  const location = useLocation()

  if (isAuthLoading) {
    return null // or a loading spinner
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}

function ReportsRoute() {
  return (
    <RoleGuard allowedRoles={['CEO']}>
      <Suspense fallback={<RouteFallback />}>
        <ReportsScreen />
      </Suspense>
    </RoleGuard>
  )
}

function TeamRoute() {
  return (
    <RoleGuard allowedRoles={['CEO', 'TEAM_MEMBER']}>
      <Suspense fallback={<RouteFallback />}>
        <TeamScreen />
      </Suspense>
    </RoleGuard>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <NotifyProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Suspense fallback={<RouteFallback />}><LoginScreen /></Suspense>} />
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route
              element={
                <ProtectedRoute>
                  <DashboardProvider>
                    <AppShell />
                  </DashboardProvider>
                </ProtectedRoute>
              }
            >
              <Route path="/home" element={<Suspense fallback={<RouteFallback />}><HomeScreen /></Suspense>} />
              <Route path="/tasks" element={<Suspense fallback={<RouteFallback />}><TasksScreen /></Suspense>} />
              <Route path="/ideas" element={<Suspense fallback={<RouteFallback />}><IdeasScreen /></Suspense>} />
              <Route path="/team" element={<TeamRoute />} />
              <Route path="/more" element={<Suspense fallback={<RouteFallback />}><MoreScreen /></Suspense>} />
              <Route path="/profile" element={<Suspense fallback={<RouteFallback />}><ProfileScreen /></Suspense>} />
              <Route path="/reports" element={<ReportsRoute />} />
            </Route>
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </BrowserRouter>
      </NotifyProvider>
    </ThemeProvider>
  )
}
