import {CheckCircle2, MessageSquare, ShieldAlert, Sparkles, UserRoundPlus} from 'lucide-react'
import Avatar from './Avatar'
import Badge from './Badge'
import EmptyState from './EmptyState'
import StatusPill from './StatusPill'
import {formatDueLabel, formatTaskStatus, getDueDateClass} from './tasks/TaskCard'
import {getStatusVariant} from '../lib/utils'

function timeAgo(value) {
  if (!value) return 'Recently'
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return 'Recently'
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function eventForTask(task) {
  const status = String(task?.status || 'TODO')
  const priority = String(task?.priority || 'MEDIUM')
  const dueClass = getDueDateClass(task?.due_date, task?.status)

  if (status === 'DONE') {
    return {
      type: 'completed',
      icon: <CheckCircle2 size={16} />,
      title: 'Task completed',
      tone: 'success',
      body: `${task?.assignee?.name || task?.assigned_to || 'A teammate'} closed out ${task?.title || 'a task'}.`
    }
  }

  if (status === 'SUBMITTED') {
    return {
      type: 'submitted',
      icon: <MessageSquare size={16} />,
      title: 'Needs review',
      tone: 'review',
      body: `${task?.assignee?.name || task?.assigned_to || 'A teammate'} submitted work for review.`
    }
  }

  if (status === 'BLOCKED') {
    return {
      type: 'blocked',
      icon: <ShieldAlert size={16} />,
      title: 'Blocked task',
      tone: 'danger',
      body: `${task?.title || 'A task'} needs support before it can move.`
    }
  }

  if (priority === 'URGENT' || dueClass === 'task-due-overdue') {
    return {
      type: 'urgent',
      icon: <ShieldAlert size={16} />,
      title: dueClass === 'task-due-overdue' ? 'Overdue work' : 'Urgent task created',
      tone: 'danger',
      body: `${task?.title || 'A task'} is carrying urgency for the team.`
    }
  }

  return {
    type: 'assigned',
    icon: <UserRoundPlus size={16} />,
    title: 'Task assigned',
    tone: 'default',
    body: `${task?.assignee?.name || task?.assigned_to || 'A teammate'} owns ${task?.title || 'a task'}.`
  }
}

export function buildActivityItems(tasks = []) {
  return tasks
    .filter(task => task?.id)
    .map(task => {
      const event = eventForTask(task)
      return {
        id: `${event.type}-${task.id}`,
        task,
        createdAt: task?.updated_at || task?.updatedAt || task?.completed_at || task?.created_at,
        ...event
      }
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
}

export default function OperationalActivityFeed({tasks = [], limit = 6, onOpenTask, emptyAction}) {
  const items = buildActivityItems(tasks).slice(0, limit)

  if (!items.length) {
    return (
      <EmptyState
        title="Activity starts when work starts moving."
        description="Create a task with an owner, priority, and due date so the team has a visible operating rhythm."
        action={emptyAction}
      />
    )
  }

  return (
    <ol className="ops-feed" aria-label="Operational activity feed">
      {items.map(item => {
        const assignee = item.task?.assignee?.name || item.task?.assigned_to || 'Team member'
        const dueLabel = formatDueLabel(item.task?.due_date, item.task?.status)

        return (
          <li className={`ops-feed-item ops-feed-${item.tone}`} key={item.id}>
            <span className="ops-feed-icon" aria-hidden="true">{item.icon || <Sparkles size={16} />}</span>
            <button type="button" onClick={() => onOpenTask?.(item.task)}>
              <span className="ops-feed-main">
                <span className="ops-feed-heading">
                  <strong>{item.title}</strong>
                  <time>{timeAgo(item.createdAt)}</time>
                </span>
                <span className="ops-feed-body">{item.body}</span>
                <span className="ops-feed-meta">
                  <Avatar user={{name: assignee}} size={24} />
                  <Badge>{assignee}</Badge>
                  <StatusPill variant={getStatusVariant(item.task?.status)}>{formatTaskStatus(item.task?.status)}</StatusPill>
                  {dueLabel && <Badge className={getDueDateClass(item.task?.due_date, item.task?.status)}>{dueLabel}</Badge>}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
