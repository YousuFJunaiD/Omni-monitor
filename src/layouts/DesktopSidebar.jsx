import {memo} from 'react'
import {NavLink} from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const baseItems = [
  ['Home', '/home'],
  ['Tasks', '/tasks'],
  ['Ideas', '/ideas'],
  ['More', '/more']
]

const DesktopSidebar = memo(function DesktopSidebar() {
  const { role } = useAuth()

  const items = [
    ...baseItems,
    ...(role === 'CEO' || role === 'TEAM_MEMBER' ? [['Team', '/team']] : [])
  ]

  return (
    <aside className="desktop-sidebar">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">OM</span>
        <span>Omnimate Monitor</span>
      </div>
      <nav className="side-nav" aria-label="Primary">
        {items.map(([label, to]) => (
          <NavLink key={to} to={to} className="nav-item">
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
})

export default DesktopSidebar
