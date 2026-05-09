import {Bell, Moon, Sun} from 'lucide-react'
import {memo, useCallback, useState} from 'react'
import Avatar from '../components/Avatar'
import GlobalSearch from '../components/GlobalSearch'
import IconButton from '../components/IconButton'
import NotificationsPanel from '../components/NotificationsPanel'
import {useAuth} from '../context/AuthContext'
import {useTheme} from '../lib/theme'
import {roleLabel} from '../lib/utils'

const TopBar = memo(function TopBar({onOpenTask}) {
  const {theme, toggleTheme} = useTheme()
  const { unreadCount, user, logout } = useAuth()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  const handleToggleNotifications = useCallback(() => {
    setNotificationsOpen(open => !open)
  }, [])

  const handleCloseNotifications = useCallback(() => {
    setNotificationsOpen(false)
  }, [])

  const handleLogout = useCallback(() => {
    if (!window.confirm('Are you sure you want to log out?')) {
      return
    }
    logout()
  }, [logout])

  return (
    <header className="top-bar">
      <div className="top-bar-title">
        <span>Operations</span>
        <small>{roleLabel(user?.role) || 'Workspace'}</small>
      </div>
      <GlobalSearch onOpenTask={onOpenTask} />
      <div className="top-bar-actions">
        <IconButton onClick={toggleTheme} label={`Switch to ${nextTheme} theme`}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
        <div className="notifications-wrap" data-notifications-root>
          <IconButton onClick={handleToggleNotifications} label={notificationsOpen ? 'Close notifications' : 'Open notifications'}>
            <Bell size={18} />
            {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
          </IconButton>
          {notificationsOpen && (
            <NotificationsPanel
              onClose={handleCloseNotifications}
              onOpenTask={onOpenTask}
            />
          )}
        </div>
        <Avatar user={user} size={40} showMenu onLogout={handleLogout} />
      </div>
    </header>
  )
})

export default TopBar
