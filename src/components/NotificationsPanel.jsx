import {Check, CheckCheck, MessageSquare, Send, ShieldCheck, Trash2, UserPlus} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'
import Button from './Button'
import EmptyState from './EmptyState'
import Skeleton from './Skeleton'
import {useAuth} from '../context/AuthContext'
import {useNotify} from '../lib/notify'
import {dismissNotification, markAllRead, markRead} from '../services/notificationService'

function formatTime(value) {
  if (!value) return ''

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ''

  const diff = Date.now() - timestamp
  const minutes = Math.max(1, Math.round(diff / 60000))
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function getActor(item) {
  return item?.actor_name || item?.actor?.name || item?.created_by_name || 'System'
}

function getNotificationType(item) {
  return String(item?.type || item?.event_type || item?.notification_type || '').toLowerCase()
}

function getNotificationIcon(item) {
  const type = getNotificationType(item)
  if (type.includes('comment')) return <MessageSquare size={16} />
  if (type.includes('status')) return <Send size={16} />
  if (type.includes('proof') || type.includes('submit')) return <ShieldCheck size={16} />
  if (type.includes('complete') || type.includes('done')) return <CheckCheck size={16} />
  return <UserPlus size={16} />
}

function getGroupLabel(item) {
  const type = getNotificationType(item)
  if (type.includes('comment')) return 'Comments'
  if (type.includes('status')) return 'Status changes'
  if (type.includes('proof') || type.includes('submit')) return 'Proof submitted'
  if (type.includes('complete') || type.includes('done')) return 'Completed'
  if (type.includes('assign')) return 'Assigned to you'
  return 'Workflow updates'
}

function getRelatedTaskId(item) {
  const meta = item?.metadata || item?.data || item?.payload || {}
  return item?.task_id || item?.related_task_id || item?.entity_id || meta?.task_id || meta?.taskId || meta?.related_task_id
}

export default function NotificationsPanel({onClose, onOpenTask}) {
  const {notifications, refreshNotifications} = useAuth()
  const panelRef = useRef(null)
  const {showToast} = useNotify()
  const [busyIds, setBusyIds] = useState(() => new Set())
  const [markingAll, setMarkingAll] = useState(false)

  const items = Array.isArray(notifications) ? notifications : []
  const loading = false
  const error = ''
  const groupedItems = useMemo(() => {
    return items.reduce((groups, item) => {
      const label = getGroupLabel(item)
      if (!groups[label]) groups[label] = []
      groups[label].push(item)
      return groups
    }, {})
  }, [items])

  useEffect(() => {
    function handlePointerDown(event) {
      if (event.target.closest('[data-notifications-root]')) {
        return
      }

      if (panelRef.current && !panelRef.current.contains(event.target)) {
        onClose?.()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [onClose])

  async function handleMarkRead(id) {
    if (!id || busyIds.has(id)) return

    setBusyIds(current => new Set(current).add(id))
    try {
      await markRead(id)
      await refreshNotifications?.()
    } catch (err) {
      showToast({type: 'error', message: err?.message || 'Notification could not be updated'})
    } finally {
      setBusyIds(current => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  async function handleOpenNotification(item) {
    if (item?.id) await handleMarkRead(item.id)
    const taskId = getRelatedTaskId(item)
    if (taskId) {
      onOpenTask?.({id: taskId, title: item?.task_title || item?.title || 'Task'})
      onClose?.()
    }
  }

  async function handleMarkAllRead() {
    if (markingAll) return
    setMarkingAll(true)
    try {
      await markAllRead()
      await refreshNotifications?.()
      showToast({type: 'success', message: 'Notifications marked as read'})
    } catch (err) {
      showToast({type: 'error', message: err?.message || 'Notifications could not be updated'})
    } finally {
      setMarkingAll(false)
    }
  }

  async function handleDismiss(id) {
    if (!id || busyIds.has(id)) return

    setBusyIds(current => new Set(current).add(id))
    try {
      await dismissNotification(id)
      await refreshNotifications?.()
    } catch (err) {
      showToast({type: 'error', message: err?.message || 'Notification could not be dismissed'})
    } finally {
      setBusyIds(current => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <section className="notifications-panel" aria-label="Notifications" ref={panelRef}>
      <div className="notifications-header">
        <div>
          <h2>Notifications</h2>
          <p className="muted">{items.length ? `${items.length} unread workflow updates` : 'No unread updates'}</p>
        </div>
        <Button onClick={handleMarkAllRead} disabled={!items.length || markingAll} loading={markingAll} variant="ghost">
          <Check size={16} />
          Mark all read
        </Button>
      </div>

      {loading && <Skeleton.List rows={3} />}
      {!loading && error && <EmptyState title="Notifications unavailable" description={error} />}
      {!loading && !error && !items.length && <EmptyState title="All caught up" description="No unread notifications right now." />}
      {!loading && !error && Boolean(items.length) && (
        <div className="notifications-groups">
          {Object.entries(groupedItems).map(([label, group]) => (
            <section className="notification-group" key={label}>
              <h3>{label}</h3>
              <ul className="notifications-list">
                {group.map((item, index) => (
                  <li className="notification-item" key={item?.id || item?.created_at || index}>
                    <button className="notification-content" type="button" disabled={busyIds.has(item?.id)} onClick={() => handleOpenNotification(item)}>
                      <span className="notification-icon" aria-hidden="true">{getNotificationIcon(item)}</span>
                      <span className="notification-copy">
                        <strong>{item?.title || 'Notification'}</strong>
                        <small>{getActor(item)}{formatTime(item?.created_at) ? ` - ${formatTime(item?.created_at)}` : ''}</small>
                        {item?.body && <small>{item?.body}</small>}
                      </span>
                    </button>
                    <button className="notification-dismiss" type="button" disabled={busyIds.has(item?.id)} aria-label="Dismiss notification" onClick={() => handleDismiss(item?.id)}>
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
