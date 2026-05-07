import {memo} from 'react'
import {NavLink} from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const baseItems = [
  ['Home', '/home'],
  ['Tasks', '/tasks'],
  ['Ideas', '/ideas'],
  ['More', '/more']
]

const MobileNav = memo(function MobileNav() {
  const { role } = useAuth()

  const items = [
    ...baseItems,
    ...(role === 'CEO' || role === 'TEAM_MEMBER' ? [['Team', '/team']] : [])
  ]

  return (
    <nav className="mobile-nav" aria-label="Primary">
      {items.map(([label, to]) => (
        <NavLink key={to} to={to} className="nav-item">
          {label}
        </NavLink>
      ))}
    </nav>
  )
})

export default MobileNav
