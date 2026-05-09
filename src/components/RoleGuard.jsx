import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {roleLabel} from '../lib/utils'
import EmptyState from './EmptyState'

export default function RoleGuard({ allowedRoles, children }) {
  const { role, isAuthLoading } = useAuth()
  const navigate = useNavigate()
  const roles = Array.isArray(allowedRoles) ? allowedRoles : []

  useEffect(() => {
    if (!isAuthLoading && role && !roles.includes(role)) {
      navigate('/home', { replace: true })
    }
  }, [role, isAuthLoading, roles, navigate])

  if (isAuthLoading) {
    return null
  }

  if (!role || !roles.includes(role)) {
    return (
      <main className="screen">
        <EmptyState
          title="Access Denied"
          description={`This page is only available to users with the following roles: ${roles.map(roleLabel).filter(Boolean).join(', ') || 'No data available'}.`}
        />
      </main>
    )
  }

  return children
}
