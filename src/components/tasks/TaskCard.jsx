import {memo} from 'react'
import StatusPill from '../StatusPill'
import Badge from '../Badge'
import {getStatusVariant} from '../../lib/utils'
import TaskActionMenu from './TaskActionMenu'

export const TASK_STATUS_LABELS = Object.freeze({
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  DONE: 'Done',
  BLOCKED: 'Blocked'
})

export function formatTaskStatus(status) {
  return TASK_STATUS_LABELS[status] || String(status || 'TODO').replace(/_/g, ' ')
}

export function getPriorityClass(priority) {
  const normalized = String(priority || 'MEDIUM').toLowerCase()
  if (normalized === 'urgent' || normalized === 'high') return 'task-priority-high'
  if (normalized === 'low') return 'task-priority-low'
  return 'task-priority-medium'
}

export function formatTaskDate(date) {
  if (!date) return ''
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(parsed)
}

export function getDueDateClass(date, status) {
  if (!date || String(status || '').toUpperCase() === 'DONE') return ''
  const due = new Date(date)
  if (Number.isNaN(due.getTime())) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  const days = Math.round((due - today) / 86400000)
  if (days < 0) return 'task-due-overdue'
  if (days <= 2) return 'task-due-soon'
  return ''
}

export function formatDueLabel(date, status) {
  const formatted = formatTaskDate(date)
  if (!formatted) return ''
  if (String(status || '').toUpperCase() === 'DONE') return `Due ${formatted}`
  const due = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  const days = Math.round((due - today) / 86400000)
  if (days < 0) return `Overdue ${formatted}`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due ${formatted}`
}

const TaskCard = memo(function TaskCard({
  task,
  className = '',
  onClick,
  onOpenDetails,
  onEdit,
  onDelete,
  onMarkComplete,
  ...props
}) {
  const safeClassName = typeof className === 'string' ? className : ''
  const isPriority = safeClassName.split(' ').includes('priority-task')
  const title = task?.title || task?.name || 'Untitled task'
  const description = task?.description || task?.details || task?.summary || 'Task details unavailable.'
  const assignee = task?.assignee?.name || task?.assigned_to || 'Unassigned'
  const dueDateValue = task?.due_date || task?.dueDate
  const dueDate = formatDueLabel(dueDateValue, task?.status)
  const dueClass = getDueDateClass(dueDateValue, task?.status)

  return (
    <article
      className={`task task-card ${safeClassName}`.trim()}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={event => {
        if (!onClick) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick(event)
        }
      }}
      {...props}
    >
      {isPriority && <span className="priority-label">Most important</span>}
      <div className="task-card-top">
        <StatusPill variant={getStatusVariant(task?.status)}>
          {formatTaskStatus(task?.status)}
        </StatusPill>
        <TaskActionMenu
          task={task}
          onOpenDetails={onOpenDetails || onClick}
          onEdit={onEdit}
          onDelete={onDelete}
          onMarkComplete={onMarkComplete}
        />
      </div>
      <div className="task-main">
        <div>
          <h3>{title}</h3>
          <p className="muted">{description}</p>
        </div>
      </div>
      <div className="task-meta-row">
        <Badge>{assignee}</Badge>
        <Badge className={getPriorityClass(task?.priority)}>{task?.priority || 'MEDIUM'}</Badge>
        {dueDate && <Badge className={dueClass}>{dueDate}</Badge>}
      </div>
    </article>
  )
})

export {getStatusVariant}
export default TaskCard
