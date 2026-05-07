import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getInitials, getAvatarTone } from '../lib/utils'
import Button from './Button'

export default function Avatar({ user = {}, size = 40, showMenu = false, onLogout }) {
  const safeUser = user && typeof user === 'object' && !Array.isArray(user) ? user : {}
  const name = safeUser?.name || 'Omnimate member'
  const sizeClass = size <= 32 ? 'avatar-sm' : size >= 56 ? 'avatar-lg' : ''
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef(null)

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleLogoutClick = () => {
    setIsOpen(false)
    onLogout?.()
  }

  const avatarContent = safeUser?.avatar_data_url ? (
    <img
      className={`avatar ${sizeClass}`.trim()}
      src={safeUser.avatar_data_url}
      alt={name}
      width={size}
      height={size}
    />
  ) : (
    <span className={`avatar avatar-initials ${getAvatarTone(name)} ${sizeClass}`.trim()} aria-label={name} role="img">
      {getInitials(name)}
    </span>
  )

  if (!showMenu) {
    return avatarContent
  }

  return (
    <div className="avatar-menu-container" ref={menuRef}>
      <button
        className="avatar-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={isOpen}
      >
        {avatarContent}
      </button>

      {isOpen && (
        <div className="avatar-dropdown">
          <div className="avatar-dropdown-header">
            <p className="avatar-dropdown-name">{name}</p>
            <p className="avatar-dropdown-role">{safeUser?.role || safeUser?.title || 'Member'}</p>
          </div>
          <hr className="avatar-dropdown-divider" />
          <nav className="avatar-dropdown-nav">
            <Link to="/profile" className="avatar-dropdown-link" onClick={() => setIsOpen(false)}>Profile</Link>
          </nav>
          <hr className="avatar-dropdown-divider" />
          <div className="avatar-dropdown-actions">
            <Button variant="danger" onClick={handleLogoutClick}>
              Logout
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
