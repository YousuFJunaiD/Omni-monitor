import {memo, useCallback, useMemo, useState} from 'react'
import Badge from '../Badge'
import EmptyState from '../EmptyState'
import StatusPill from '../StatusPill'
import {getStatusVariant} from '../../lib/utils'
import {
  formatDueLabel,
  formatTaskStatus,
  getDueDateClass,
  getPriorityClass,
  TASK_STATUS_LABELS
} from './TaskCard'

export const KANBAN_STATUSES = Object.freeze(['TODO', 'IN_PROGRESS', 'SUBMITTED', 'DONE', 'BLOCKED'])

function buildColumns(tasks) {
  const grouped = KANBAN_STATUSES.reduce((map, status) => {
    map[status] = []
    return map
  }, {})

  tasks.forEach(task => {
    const status = KANBAN_STATUSES.includes(task?.status) ? task.status : 'TODO'
    grouped[status].push(task)
  })

  return grouped
}

function getAdjacentStatus(status, direction) {
  const index = KANBAN_STATUSES.indexOf(status)
  if (index < 0) return null
  return KANBAN_STATUSES[index + direction] || null
}

const KanbanTaskCard = memo(function KanbanTaskCard({
  task,
  grabbed,
  moving,
  onOpen,
  onDragStart,
  onDragEnd,
  onMove,
  onToggleGrab,
  onCancelGrab,
  onDragEnter
}) {
  const dueDateValue = task?.due_date || task?.dueDate
  const dueLabel = formatDueLabel(dueDateValue, task?.status)
  const previousStatus = getAdjacentStatus(task?.status, -1)
  const nextStatus = getAdjacentStatus(task?.status, 1)

  const handleKeyDown = event => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(task)
      return
    }

    if (event.key === ' ') {
      event.preventDefault()
      onToggleGrab(task)
      return
    }

    if (!grabbed) return

    if (event.key === 'Escape') {
      event.preventDefault()
      onCancelGrab()
      return
    }

    if (event.key === 'ArrowLeft' && previousStatus) {
      event.preventDefault()
      onMove(task, previousStatus)
    }

    if (event.key === 'ArrowRight' && nextStatus) {
      event.preventDefault()
      onMove(task, nextStatus)
    }
  }

  return (
    <article
      aria-grabbed={grabbed}
      className={`kanban-task ${grabbed ? 'is-grabbed' : ''} ${moving ? 'is-moving' : ''}`.trim()}
      draggable
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task)}
      onDragEnd={onDragEnd}
      onDragStart={event => onDragStart(event, task)}
      onKeyDown={handleKeyDown}
    >
      <div className="kanban-task-top">
        <StatusPill variant={getStatusVariant(task?.status)}>{formatTaskStatus(task?.status)}</StatusPill>
        <Badge className={getPriorityClass(task?.priority)}>{task?.priority || 'MEDIUM'}</Badge>
      </div>
      <h3>{task?.title || 'Untitled task'}</h3>
      <p>{task?.description || task?.details || 'No task description.'}</p>
      <div className="kanban-task-meta">
        <span>{task?.assignee?.name || task?.assigned_to || 'Unassigned'}</span>
        {dueLabel && <span className={getDueDateClass(dueDateValue, task?.status)}>{dueLabel}</span>}
      </div>
      <div className="kanban-mobile-moves" aria-label="Move task">
        <button type="button" disabled={!previousStatus || moving} onClick={event => {
          event.stopPropagation()
          onMove(task, previousStatus)
        }}>
          Back
        </button>
        <button type="button" disabled={!nextStatus || moving} onClick={event => {
          event.stopPropagation()
          onMove(task, nextStatus)
        }}>
          Next
        </button>
      </div>
    </article>
  )
})

const KanbanColumn = memo(function KanbanColumn({
  status,
  tasks,
  active,
  movingTaskId,
  onOpen,
  onDropTask,
  onDragStart,
  onDragEnd,
  onMove,
  grabbedTaskId,
  onToggleGrab,
  onCancelGrab,
  onDragEnter
}) {
  return (
    <section
      className={`kanban-column ${active ? 'is-drop-target' : ''}`.trim()}
      onDragEnter={onDragEnter}
      onDragOver={event => event.preventDefault()}
      onDrop={event => onDropTask(event, status)}
    >
      <div className="kanban-column-header">
        <div>
          <h2>{TASK_STATUS_LABELS[status] || status}</h2>
          <p>{tasks.length} tasks</p>
        </div>
        <StatusPill variant={getStatusVariant(status)}>{formatTaskStatus(status)}</StatusPill>
      </div>
      <div className="kanban-column-list">
        {tasks.length === 0 ? (
          <div className="kanban-empty">Drop tasks here</div>
        ) : (
          tasks.map(task => (
            <KanbanTaskCard
              key={task?.id || task?.title}
              task={task}
              grabbed={grabbedTaskId === task?.id}
              moving={movingTaskId === task?.id}
              onOpen={onOpen}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onMove={onMove}
              onToggleGrab={onToggleGrab}
              onCancelGrab={onCancelGrab}
            />
          ))
        )}
      </div>
    </section>
  )
})

export default function KanbanBoard({tasks = [], onOpenTask, onMoveTask, movingTaskId}) {
  const [draggedTask, setDraggedTask] = useState(null)
  const [hoverStatus, setHoverStatus] = useState('')
  const [grabbedTaskId, setGrabbedTaskId] = useState('')
  const columns = useMemo(() => buildColumns(tasks), [tasks])

  const handleDragStart = useCallback((event, task) => {
    setDraggedTask(task)
    setGrabbedTaskId('')
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task?.id || '')
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedTask(null)
    setHoverStatus('')
  }, [])

  const handleDropTask = useCallback((event, status) => {
    event.preventDefault()
    setHoverStatus('')
    if (!draggedTask || draggedTask.status === status) {
      setDraggedTask(null)
      return
    }
    onMoveTask(draggedTask, status)
    setDraggedTask(null)
  }, [draggedTask, onMoveTask])

  const handleMove = useCallback((task, status) => {
    if (!task || !status || task.status === status) return
    onMoveTask(task, status)
    setGrabbedTaskId('')
  }, [onMoveTask])

  const handleToggleGrab = useCallback(task => {
    setGrabbedTaskId(current => current === task?.id ? '' : task?.id)
  }, [])

  if (!tasks.length) {
    return (
      <EmptyState
        title="No tasks match this board view."
        description="Adjust the filters to bring work back into the Kanban lanes."
      />
    )
  }

  return (
    <div className="kanban-board" aria-label="Task Kanban board">
      {KANBAN_STATUSES.map(status => (
        <KanbanColumn
          key={status}
          status={status}
          tasks={columns[status]}
          active={hoverStatus === status}
          movingTaskId={movingTaskId}
          onOpen={onOpenTask}
          onDropTask={handleDropTask}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onMove={handleMove}
          grabbedTaskId={grabbedTaskId}
          onToggleGrab={handleToggleGrab}
          onCancelGrab={() => setGrabbedTaskId('')}
          onDragEnter={() => setHoverStatus(status)}
        />
      ))}
    </div>
  )
}
