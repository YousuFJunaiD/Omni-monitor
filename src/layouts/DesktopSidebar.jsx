import {memo} from 'react'
import {Home, Layers3, Lightbulb, MoreHorizontal, Users} from 'lucide-react'
import {NavLink} from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const baseItems = [
  ['Home', '/home', Home],
  ['Tasks', '/tasks', Layers3],
  ['Ideas', '/ideas', Lightbulb],
  ['More', '/more', MoreHorizontal]
]

const DesktopSidebar = memo(function DesktopSidebar() {
  const { role, user } = useAuth()

  const items = [
    ...baseItems,
    ...(role === 'CEO' || role === 'TEAM_MEMBER' ? [['Team', '/team', Users]] : [])
  ]

  return (
    <aside className="desktop-sidebar">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">OM</span>
        <span>Omnimate</span>
      </div>
      <div className="workspace-card">
        <span>Workspace</span>
        <strong>Operations Monitor</strong>
        <small>{user?.name || 'Team workspace'}{role ? ` - ${role}` : ''}</small>
      </div>
      <nav className="side-nav" aria-label="Primary">
        {items.map(([label, to, Icon]) => (
          <NavLink key={to} to={to} className="nav-item">
            <Icon size={17} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
})

export default DesktopSidebar
