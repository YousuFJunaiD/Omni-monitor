import {useCallback, useEffect, useMemo, useState} from 'react'
import Avatar from '../components/Avatar'
import Badge from '../components/Badge'
import Button from '../components/Button'
import EmptyState from '../components/EmptyState'
import Field from '../components/Field'
import OperationalActivityFeed from '../components/OperationalActivityFeed'
import ScreenLoader from '../components/ScreenLoader'
import StatusPill from '../components/StatusPill'
import {formatDueLabel, formatTaskStatus, getDueDateClass} from '../components/tasks/TaskCard'
import {useNotify} from '../lib/notify'
import useAsync from '../lib/useAsync'
import {useDashboardContext} from '../context/DashboardContext'
import {getProfile, updateAvatar} from '../services/profileService'
import { dataUrlBytes, getStatusVariant } from '../lib/utils'

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = dataUrl
  })
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function compressImage(file, maxSize = 256, quality = 0.8) {
  const dataUrl = await readFileAsDataURL(file)
  const image = await loadImage(dataUrl)
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  canvas.width = width
  canvas.height = height
  context.drawImage(image, 0, 0, width, height)

  const compressed = canvas.toDataURL('image/jpeg', quality)
  if (dataUrlBytes(compressed) > 200 * 1024) {
    throw new Error('Avatar image must be 200KB or smaller after compression')
  }

  return compressed
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [preview, setPreview] = useState('')
  const {run, loading: saving} = useAsync()
  const {showToast} = useNotify()
  const {me, tasks, refresh, loading: dashboardLoading, error: dashboardError} = useDashboardContext()

  const userId = me?.id
  
  // Merged loading state
  const isLoading = profileLoading || dashboardLoading
  const hasError = profileError || dashboardError

  const loadProfile = useCallback(async ({active = true, showLoading = true} = {}) => {
    if (showLoading) {
      setProfileLoading(true)
    }
    setProfileError('')

    try {
      if (!userId) {
        throw new Error('Profile id was not returned')
      }

      const data = await getProfile(userId)
      if (active) {
        const nextProfile = data?.profile || data?.person || data?.user || data
        setProfile(nextProfile && typeof nextProfile === 'object' && !Array.isArray(nextProfile) ? nextProfile : null)
      }
    } catch (err) {
      if (active) {
        setProfileError(err?.message || 'Profile could not be loaded')
        setProfile(null)
        showToast({type: 'error', message: err?.message || 'Profile could not be loaded'})
      }
    } finally {
      if (active && showLoading) {
        setProfileLoading(false)
      }
    }
  }, [showToast, userId])

  useEffect(() => {
    let active = true
    if (userId) {
      loadProfile({active})
    }

    return () => {
      active = false
    }
  }, [loadProfile, userId])

  async function handleAvatarChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const dataUrl = await compressImage(file)
      setPreview(dataUrl)
    } catch (err) {
      setPreview('')
      showToast({type: 'error', message: err?.message || 'Avatar image could not be prepared'})
    } finally {
      event.target.value = ''
    }
  }

  async function handleAvatarSave() {
    if (!preview) return

    try {
      await run(async () => {
        await updateAvatar(preview)
        setProfile(current => ({...(current?.person || current?.user || current || {}), avatar_data_url: preview}))
        await loadProfile({active: true, showLoading: false})
      })
      setPreview('')
      showToast({type: 'success', message: 'Avatar updated'})
    } catch (err) {
      showToast({type: 'error', message: err?.message || 'Avatar could not be saved'})
    }
  }

  const profileSource = profile?.person || profile?.user || profile
  const person = profileSource && typeof profileSource === 'object' && !Array.isArray(profileSource) ? profileSource : {}
  const avatarUser = preview ? {...person, avatar_data_url: preview} : person
  const safeTasks = Array.isArray(tasks) ? tasks : []
  const ownedTasks = useMemo(() => safeTasks.filter(task => {
    const assigneeId = task?.assignee?.id || task?.assigned_to_id || task?.assignee_id
    const assigneeName = task?.assignee?.name || task?.assigned_to
    return (
      (person?.id && assigneeId && String(person.id) === String(assigneeId)) ||
      (person?.name && assigneeName && String(person.name).toLowerCase() === String(assigneeName).toLowerCase())
    )
  }), [person?.id, person?.name, safeTasks])
  const activeTasks = ownedTasks.filter(task => String(task?.status || '').toUpperCase() !== 'DONE')
  const completedTasks = ownedTasks.filter(task => String(task?.status || '').toUpperCase() === 'DONE')
  const blockedTasks = ownedTasks.filter(task => String(task?.status || '').toUpperCase() === 'BLOCKED')
  const reviewTasks = ownedTasks.filter(task => String(task?.status || '').toUpperCase() === 'SUBMITTED')

  return (
    <>
      <header className="screen-header">
        <p className="eyebrow">Account</p>
        <h1>Profile</h1>
        <p className="muted">Keep your identity, role, and avatar recognizable across the workspace.</p>
      </header>
      <ScreenLoader
        loading={isLoading}
        error={hasError}
        isEmpty={!Object.keys(person).length && !isLoading}
        emptyTitle="Profile details are unavailable."
        emptyDescription="Refresh once your account data has synced, then add an avatar so teammates can recognize you quickly."
        onRetry={() => {
          refresh()
          loadProfile({active: true})
        }}
      >
        <div className="profile-grid">
          <section className="panel profile-hero-panel">
            <div className="profile-hero">
              <Avatar user={avatarUser} size={72} />
              <div>
                <p className="eyebrow">Workspace identity</p>
                <h2>{person?.name || 'Unnamed profile'}</h2>
                <p className="muted">{person?.title || person?.role || 'Role unavailable'}</p>
                <div className="profile-badge-row">
                  <Badge className="role-badge">{person?.role || 'Member'}</Badge>
                  <Badge>Score {person?.score ?? 'Unavailable'}</Badge>
                </div>
              </div>
            </div>
            <Field label="Avatar upload" type="file" accept="image/*" onChange={handleAvatarChange} disabled={saving} />
            {preview && (
              <div className="profile-actions">
                <Button onClick={handleAvatarSave} variant="primary" disabled={saving} loading={saving}>
                  {saving ? 'Saving...' : 'Save avatar'}
                </Button>
                <Button onClick={() => setPreview('')} variant="secondary" disabled={saving}>Cancel</Button>
              </div>
            )}
          </section>
          <section className="panel profile-stats-panel">
            <div className="section-title">
              <h2>Contribution</h2>
            </div>
            <div className="stats ops-stats">
              <div className="stat"><div className="stat-icon">A</div><div><b>{activeTasks.length}</b><span>Active</span></div></div>
              <div className="stat"><div className="stat-icon">C</div><div><b>{completedTasks.length}</b><span>Completed</span></div></div>
              <div className="stat"><div className="stat-icon">R</div><div><b>{reviewTasks.length}</b><span>In review</span></div></div>
              <div className="stat danger-stat"><div className="stat-icon">B</div><div><b>{blockedTasks.length}</b><span>Blocked</span></div></div>
            </div>
          </section>
          <section className="panel">
            <div className="section-title">
              <h2>Active work</h2>
            </div>
            {activeTasks.length ? (
              <div className="profile-task-list">
                {activeTasks.slice(0, 5).map(task => (
                  <article key={task.id} className="profile-task-row">
                    <div>
                      <h3>{task.title}</h3>
                      <p className="muted">{task.description || 'No description provided.'}</p>
                    </div>
                    <div className="profile-task-pills">
                      <StatusPill variant={getStatusVariant(task.status)}>{formatTaskStatus(task.status)}</StatusPill>
                      {task.due_date && <Badge className={getDueDateClass(task.due_date, task.status)}>{formatDueLabel(task.due_date, task.status)}</Badge>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="No active tasks" description="When new work is assigned, this profile becomes a personal operating surface." />
            )}
          </section>
          <section className="panel">
            <div className="section-title">
              <h2>Recent contribution</h2>
            </div>
            <OperationalActivityFeed tasks={ownedTasks} limit={4} />
          </section>
        </div>
      </ScreenLoader>
    </>
  )
}
