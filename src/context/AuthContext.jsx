import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getToken, setToken, logout as clearToken, registerLogoutHandler, login as loginRPC } from '../services/authService'
import { clearDashboardCache, getDashboard } from '../services/dashboardService'
import { getNotifications } from '../services/notificationService'

const AuthContext = createContext()

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const pollingRef = useRef(null)

  const stopNotificationPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const loadNotifications = useCallback(async () => {
    if (!getToken()) return

    try {
      const res = await getNotifications(30)
      const items = asArray(res?.items || res?.notifications)
      const count = res?.unread_count ?? items.filter(item => !item?.read_at).length

      setNotifications(items)
      setUnreadCount(Number.isFinite(Number(count)) ? Number(count) : 0)
    } catch (err) {
      // Silent fail for polling
    }
  }, [])

  const startNotificationPolling = useCallback(() => {
    if (pollingRef.current) {
      return
    }

    loadNotifications()
    pollingRef.current = setInterval(loadNotifications, 15000)
  }, [loadNotifications])

  const loadUserData = useCallback(async () => {
    try {
      const data = await getDashboard()
      const nextUser = asObject(data?.user || data?.me || data?.profile || data?.person)
      if (nextUser) {
        setUser(nextUser)
        setRole(nextUser?.role || 'INTERN')
      } else {
        setUser(null)
        setRole('INTERN')
      }
    } catch (err) {
      setRole('INTERN')
    }
  }, [])

  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = getToken()
      if (storedToken) {
        setTokenState(storedToken)
        setIsAuthenticated(true)
        await loadUserData()
        startNotificationPolling()
      }
      setIsAuthLoading(false)
    }

    initializeAuth()

    return () => {
      stopNotificationPolling()
    }
  }, [loadUserData, startNotificationPolling, stopNotificationPolling])

  useEffect(() => {
    registerLogoutHandler(() => {
      setTokenState(null)
      setIsAuthenticated(false)
      setUser(null)
      setRole(null)
      setNotifications([])
      setUnreadCount(0)
      stopNotificationPolling()
    })
  }, [stopNotificationPolling])

  const login = async (username, password) => {
    clearDashboardCache()
    const { token: nextToken, user: nextUser } = await loginRPC(username, password)
    setToken(nextToken)
    setTokenState(nextToken)
    setIsAuthenticated(true)
    setUser(asObject(nextUser))
    setRole(nextUser?.role || 'INTERN')
    startNotificationPolling()
  }

  const logout = () => {
    clearToken()
    clearDashboardCache()
    setTokenState(null)
    setIsAuthenticated(false)
    setUser(null)
    setRole(null)
    setNotifications([])
    setUnreadCount(0)
    stopNotificationPolling()
  }

  const value = {
    token,
    isAuthenticated,
    user,
    role,
    isAuthLoading,
    notifications: asArray(notifications),
    unreadCount: Number.isFinite(Number(unreadCount)) ? Number(unreadCount) : 0,
    refreshNotifications: loadNotifications,
    login,
    logout
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
