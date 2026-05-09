import {useAuth} from '../context/AuthContext'
import {useDashboardContext} from '../context/DashboardContext'
import Avatar from '../components/Avatar'
import Badge from '../components/Badge'
import {roleLabel} from '../lib/utils'

export default function MoreScreen() {
  const { user, role } = useAuth()
  const { me } = useDashboardContext()
  
  const hasDashboardUser = me && typeof me === 'object' && !Array.isArray(me) && Object.keys(me).length > 0
  const rawUser = hasDashboardUser ? me : user
  const displayUser = rawUser && typeof rawUser === 'object' && !Array.isArray(rawUser) ? rawUser : {}

  return (
    <>
      <header className="screen-header">
        <p className="eyebrow">Settings</p>
        <h1>More</h1>
        <p className="muted">Manage account context and personal workspace preferences.</p>
      </header>
      <section className="panel profile-panel">
        <div className="person profile-person">
          <div>
            <p className="eyebrow">Profile</p>
            <h2>{displayUser?.name || 'User profile'}</h2>
            <p className="muted">{roleLabel(role || displayUser?.role) || 'Role unavailable'}</p>
            {displayUser?.title && <p className="muted">{displayUser?.title}</p>}
            <div className="role-row">
              <span className="badge role-badge">{roleLabel(role || displayUser?.role) || 'General'}</span>
            </div>
          </div>
          <Avatar user={displayUser} size={80} />
        </div>
      </section>
    </>
  )
}
