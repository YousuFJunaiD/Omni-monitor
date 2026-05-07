import {useEffect, useMemo, useRef, useState} from 'react'
import Button from '../Button'
import Badge from '../Badge'
import StatusPill from '../StatusPill'
import Skeleton from '../Skeleton'
import {TASK_STATUSES, getActivityTimeline, getTaskById, getTaskComments} from '../../services/taskService'
import {getStatusVariant} from '../../lib/utils'
import TaskCommentList from './TaskCommentList'
import TaskActivityTimeline from './TaskActivityTimeline'
import TaskActionMenu from './TaskActionMenu'
import {formatDueLabel, formatTaskStatus, getDueDateClass, getPriorityClass} from './TaskCard'

function formatLongDate(value) {
  if (!value) return 'No due date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No due date'
  return new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric', year: 'numeric'}).format(date)
}

export default function TaskDetailsDrawer({
  open,
  taskId,
  task: initialTask,
  onClose,
  onStatusChange,
  onAddComment,
  onEdit,
  onDelete,
  onMarkComplete
}) {
  const drawerRef = useRef(null)
  const [task, setTask] = useState(initialTask || null)
  const [commentsResult, setCommentsResult] = useState({items: [], nextCursor: null, hasMore: false})
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [error, setError] = useState('')

  const effectiveTaskId = taskId || initialTask?.id
  const comments = commentsResult.items

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event) {
      if (event.key === 'Escape' && !statusSaving) onClose?.()
      if (event.key !== 'Tab') return

      const focusable = drawerRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')
      const items = Array.from(focusable || [])
      if (!items.length) return

      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open, statusSaving])

  useEffect(() => {
    if (!open || !effectiveTaskId) return
    let alive = true

    async function loadDetails() {
      setLoading(true)
      setError('')
      try {
        const [nextTask, nextComments, nextActivity] = await Promise.all([
          getTaskById(effectiveTaskId),
          getTaskComments(effectiveTaskId),
          getActivityTimeline(effectiveTaskId)
        ])
        if (!alive) return
        setTask(nextTask)
        setCommentsResult(nextComments)
        setActivity(nextActivity)
      } catch (err) {
        if (alive) setError(err?.message || 'Task details could not be loaded.')
      } finally {
        if (alive) setLoading(false)
      }
    }

    loadDetails()
    return () => {
      alive = false
    }
  }, [effectiveTaskId, open])

  useEffect(() => {
    if (initialTask) setTask(initialTask)
  }, [initialTask])

  const meta = useMemo(() => ([
    ['Assignee', task?.assignee?.name || task?.assigned_to || 'Unassigned'],
    ['Assignee role', task?.assignee?.title || task?.assignee?.role || 'Team member'],
    ['Creator', task?.creator?.name || task?.assigned_by || 'Unknown'],
    ['Due date', formatLongDate(task?.due_date)],
    ['Priority', task?.priority || 'MEDIUM']
  ]), [task])
  const dueLabel = formatDueLabel(task?.due_date, task?.status) || 'No due date'
  const dueClass = getDueDateClass(task?.due_date, task?.status)

  if (!open) return null

  async function refreshDrawer(forceRefresh = true) {
    if (!effectiveTaskId) return
    const [nextTask, nextComments, nextActivity] = await Promise.all([
      getTaskById(effectiveTaskId, {forceRefresh}),
      getTaskComments(effectiveTaskId, {forceRefresh}),
      getActivityTimeline(effectiveTaskId, {forceRefresh})
    ])
    setTask(nextTask)
    setCommentsResult(nextComments)
    setActivity(nextActivity)
  }

  async function handleStatusChange(event) {
    const nextStatus = event.target.value
    const previousTask = task
    setTask(current => current ? {...current, status: nextStatus} : current)
    setStatusSaving(true)
    setError('')
    try {
      await onStatusChange?.(effectiveTaskId, nextStatus)
    } catch (err) {
      setTask(previousTask)
      setError(err?.message || 'Status could not be updated.')
      setStatusSaving(false)
      return
    }

    try {
      await refreshDrawer()
    } catch (err) {
      setError(err?.message || 'Status updated, but the latest task details could not be loaded.')
    } finally {
      setStatusSaving(false)
    }
  }

  async function handleAddComment(note) {
    const optimisticComment = {
      id: `optimistic-comment-${Date.now()}`,
      taskId: effectiveTaskId,
      author: 'You',
      body: note,
      createdAt: new Date().toISOString()
    }
    const previousComments = commentsResult

    setCommentsResult(current => ({
      ...current,
      items: [...current.items, optimisticComment]
    }))

    try {
      await onAddComment?.(effectiveTaskId, note)
    } catch (err) {
      setCommentsResult(previousComments)
      throw err
    }

    try {
      await refreshDrawer()
    } catch (err) {
      setError(err?.message || 'Comment added, but the latest task details could not be loaded.')
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose?.()
    }}>
      <aside className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-details-title" ref={drawerRef}>
        <div className="task-drawer-header">
          <div>
            <p className="eyebrow">Task details</p>
            <h2 id="task-details-title">{task?.title || initialTask?.title || 'Untitled task'}</h2>
          </div>
          <div className="task-drawer-actions">
            {task && (
              <TaskActionMenu
                task={task}
                onEdit={onEdit}
                onDelete={onDelete}
                onMarkComplete={onMarkComplete}
              />
            )}
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
        {loading && !task ? (
          <Skeleton.Card />
        ) : (
          <div className="task-drawer-content">
            {error && <p className="field-error">{error}</p>}
            <section className="task-drawer-section task-overview-section">
              <div className="task-section-header">
                <h3>Overview</h3>
                <div className="task-detail-badges">
                  <StatusPill variant={getStatusVariant(task?.status)}>{formatTaskStatus(task?.status)}</StatusPill>
                  <Badge className={getPriorityClass(task?.priority)}>{task?.priority || 'MEDIUM'}</Badge>
                  <Badge className={dueClass}>{dueLabel}</Badge>
                </div>
              </div>
              <p>{task?.description || task?.details || 'No description provided.'}</p>
              <div className="task-status-control">
                <label className="field-label" htmlFor="task-status">Status</label>
                <select
                  className="field-control"
                  id="task-status"
                  value={task?.status || 'TODO'}
                  onChange={handleStatusChange}
                  disabled={statusSaving}
                >
                  {TASK_STATUSES.map(status => (
                    <option key={status} value={status}>{formatTaskStatus(status)}</option>
                  ))}
                </select>
                {statusSaving && <span className="saving-hint">Saving status...</span>}
              </div>
              <dl className="task-meta-grid">
                {meta.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <TaskCommentList comments={comments} loading={loading} onAddComment={handleAddComment} />
            <TaskActivityTimeline items={activity} loading={loading} task={task} />
          </div>
        )}
      </aside>
    </div>
  )
}
