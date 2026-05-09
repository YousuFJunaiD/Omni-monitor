import {Suspense, lazy, memo, useCallback, useMemo, useState, useTransition} from 'react'
import Button from '../components/Button'
import TaskCard from '../components/tasks/TaskCard'
import ScreenLoader from '../components/ScreenLoader'
import {useDashboardContext} from '../context/DashboardContext'
import {useNotify} from '../lib/notify'

const CreateTaskModal = lazy(() => import('../components/tasks/CreateTaskModal'))
const ConfirmDeleteTaskModal = lazy(() => import('../components/tasks/ConfirmDeleteTaskModal'))
const EditTaskModal = lazy(() => import('../components/tasks/EditTaskModal'))
const KanbanBoard = lazy(() => import('../components/tasks/KanbanBoard'))
const TaskDetailsDrawer = lazy(() => import('../components/tasks/TaskDetailsDrawer'))

const STATUS_FILTERS = [
  ['ALL', 'All'],
  ['TODO', 'To do'],
  ['IN_PROGRESS', 'In progress'],
  ['SUBMITTED', 'Review'],
  ['BLOCKED', 'Blocked'],
  ['DONE', 'Done']
]

const PRIORITY_FILTERS = ['ALL', 'URGENT', 'HIGH', 'MEDIUM', 'LOW']

const TaskRow = memo(function TaskRow({task, onOpen, onEdit, onDelete, onMarkComplete}) {
  return (
    <TaskCard
      task={task}
      onClick={() => onOpen(task)}
      onOpenDetails={onOpen}
      onEdit={onEdit}
      onDelete={onDelete}
      onMarkComplete={onMarkComplete}
    />
  )
})

export default function TasksScreen() {
  const {showToast} = useNotify()
  const {tasks, tasksById, visibleUsers, loading, error, refresh, createTask, updateTask, updateTaskStatus, deleteTask, addTaskComment} = useDashboardContext()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [deletingTask, setDeletingTask] = useState(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [priorityFilter, setPriorityFilter] = useState('ALL')
  const [assigneeFilter, setAssigneeFilter] = useState('ALL')
  const [dueSort, setDueSort] = useState('URGENT')
  const [viewMode, setViewMode] = useState('BOARD')
  const [movingTaskId, setMovingTaskId] = useState('')
  const [, startTransition] = useTransition()
  const safeTasks = Array.isArray(tasks) ? tasks : []

  const filteredTasks = useMemo(() => {
    return safeTasks
      .filter(task => statusFilter === 'ALL' || task?.status === statusFilter)
      .filter(task => priorityFilter === 'ALL' || task?.priority === priorityFilter)
      .filter(task => {
        if (assigneeFilter === 'ALL') return true
        const assigneeId = task?.assignee?.id || task?.assigned_to_id || task?.assignee_id
        return String(assigneeId || '') === String(assigneeFilter)
      })
      .sort((a, b) => {
        const aTime = a?.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY
        const bTime = b?.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY
        if (dueSort === 'LATEST') return bTime - aTime
        if (dueSort === 'NONE_LAST') return aTime - bTime
        const aBlocked = String(a?.status || '') === 'BLOCKED' ? -1 : 0
        const bBlocked = String(b?.status || '') === 'BLOCKED' ? -1 : 0
        if (aBlocked !== bBlocked) return aBlocked - bBlocked
        return aTime - bTime
      })
  }, [assigneeFilter, dueSort, priorityFilter, safeTasks, statusFilter])

  const handleCreateTask = useCallback(() => setCreateOpen(true), [])
  const handleOpenTask = useCallback(task => setSelectedTask(task), [])
  const handleEditTask = useCallback(task => setEditingTask(task), [])
  const handleDeleteTask = useCallback(task => setDeletingTask(task), [])
  const setFilter = useCallback((setter, value) => {
    startTransition(() => setter(value))
  }, [startTransition])

  const handleSubmitTask = useCallback(async input => {
    await createTask(input)
    setCreateOpen(false)
    showToast({type: 'success', message: 'Task created'})
  }, [createTask, showToast])

  const handleStatusChange = useCallback(async (taskId, status) => {
    await updateTaskStatus(taskId, status)
    showToast({type: 'success', message: 'Task status updated'})
  }, [showToast, updateTaskStatus])

  const handleMoveTask = useCallback(async (task, status) => {
    if (!task?.id || task.status === status) return
    setMovingTaskId(task.id)
    try {
      await updateTaskStatus(task.id, status)
      showToast({type: 'success', message: `Moved to ${status.replace(/_/g, ' ').toLowerCase()}`})
    } catch (err) {
      showToast({type: 'error', message: err?.message || 'Task could not be moved'})
    } finally {
      setMovingTaskId('')
    }
  }, [showToast, updateTaskStatus])

  const handleMarkComplete = useCallback(async task => {
    if (!task?.id) return
    try {
      await updateTaskStatus(task.id, 'DONE')
      showToast({type: 'success', message: 'Task marked complete'})
    } catch (err) {
      showToast({type: 'error', message: err?.message || 'Task could not be completed'})
    }
  }, [showToast, updateTaskStatus])

  const handleSubmitEdit = useCallback(async (taskId, updates) => {
    try {
      await updateTask(taskId, updates)
      setEditingTask(null)
      showToast({type: 'success', message: 'Task updated'})
    } catch (err) {
      showToast({type: 'error', message: err?.message || 'Task could not be updated'})
      throw err
    }
  }, [showToast, updateTask])

  const handleConfirmDelete = useCallback(async task => {
    try {
      await deleteTask(task.id)
      setDeletingTask(null)
      if (selectedTask?.id === task.id) setSelectedTask(null)
      showToast({type: 'success', message: 'Task deleted'})
    } catch (err) {
      showToast({type: 'error', message: err?.message || 'Task could not be deleted'})
      throw err
    }
  }, [deleteTask, selectedTask, showToast])

  const handleAddComment = useCallback(async (taskId, note) => {
    await addTaskComment(taskId, note)
    showToast({type: 'success', message: 'Comment added'})
  }, [addTaskComment, showToast])

  return (
    <>
      <header className="screen-header">
        <div className="top">
          <div>
            <p className="eyebrow">Work queue</p>
            <h1>Tasks</h1>
            <p className="muted">Track ownership, status, and the next piece of work that needs momentum.</p>
          </div>
          <Button variant="primary" onClick={handleCreateTask}>
            Create Task
          </Button>
        </div>
      </header>
      <ScreenLoader
        loading={loading}
        error={error}
        isEmpty={safeTasks.length === 0}
        emptyTitle="Create your first task to start tracking execution and team progress."
        emptyDescription="Give the team one clear owner, priority, and due date so work can start moving."
        emptyAction={<Button variant="primary" onClick={handleCreateTask}>Create Task</Button>}
        onRetry={refresh}
      >
        <section className="panel">
          <div className="task-filter-bar" aria-label="Task filters">
            <div className="segmented-control" role="group" aria-label="Status filter">
              {STATUS_FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={statusFilter === value ? 'is-active' : ''}
                  onClick={() => setFilter(setStatusFilter, value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="segmented-control compact-control" role="group" aria-label="Task view">
              <button type="button" className={viewMode === 'BOARD' ? 'is-active' : ''} onClick={() => setViewMode('BOARD')}>Kanban</button>
              <button type="button" className={viewMode === 'LIST' ? 'is-active' : ''} onClick={() => setViewMode('LIST')}>List</button>
            </div>
            <div className="filter-selects">
              <label>
                <span>Priority</span>
                <select className="field-control" value={priorityFilter} onChange={event => setFilter(setPriorityFilter, event.target.value)}>
                  {PRIORITY_FILTERS.map(priority => (
                    <option key={priority} value={priority}>{priority === 'ALL' ? 'All priorities' : priority}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Assignee</span>
                <select className="field-control" value={assigneeFilter} onChange={event => setFilter(setAssigneeFilter, event.target.value)}>
                  <option value="ALL">All assignees</option>
                  {visibleUsers.map(user => (
                    <option key={user?.id || user?.name} value={user?.id}>{user?.name || 'Team member'}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Due date</span>
                <select className="field-control" value={dueSort} onChange={event => setFilter(setDueSort, event.target.value)}>
                  <option value="URGENT">Most urgent</option>
                  <option value="NONE_LAST">Nearest due</option>
                  <option value="LATEST">Latest due</option>
                </select>
              </label>
            </div>
          </div>
          <div className="task-results-meta">
            <span>{filteredTasks.length} of {safeTasks.length} tasks shown</span>
          </div>
          {viewMode === 'BOARD' ? (
            <Suspense fallback={<div className="kanban-skeleton" aria-label="Loading Kanban" />}>
              <KanbanBoard
                tasks={filteredTasks}
                movingTaskId={movingTaskId}
                onOpenTask={handleOpenTask}
                onEditTask={handleEditTask}
                onDeleteTask={handleDeleteTask}
                onAssignTask={handleEditTask}
                onMoveTask={handleMoveTask}
              />
            </Suspense>
          ) : filteredTasks.length === 0 ? (
            <div className="empty-state">
              <h2>No tasks match these filters.</h2>
              <p>Try loosening the status, priority, or assignee filter to find the work you need.</p>
            </div>
          ) : (
            filteredTasks.map((task, index) => (
              <TaskRow
                key={task?.id ?? task?.title ?? index}
                task={task}
                onOpen={handleOpenTask}
                onEdit={handleEditTask}
                onDelete={handleDeleteTask}
                onMarkComplete={handleMarkComplete}
              />
            ))
          )}
        </section>
      </ScreenLoader>
      <Suspense fallback={null}>
        {createOpen && (
          <CreateTaskModal
            open
            users={visibleUsers}
            onClose={() => setCreateOpen(false)}
            onSubmit={handleSubmitTask}
          />
        )}
        {editingTask && (
          <EditTaskModal
            open
            task={editingTask?.id ? (tasksById?.[editingTask.id] || editingTask) : editingTask}
            onClose={() => setEditingTask(null)}
            onSubmit={handleSubmitEdit}
          />
        )}
        {deletingTask && (
          <ConfirmDeleteTaskModal
            open
            task={deletingTask}
            onClose={() => setDeletingTask(null)}
            onConfirm={handleConfirmDelete}
          />
        )}
        {selectedTask && (
          <TaskDetailsDrawer
            open
            task={selectedTask?.id ? (tasksById?.[selectedTask.id] || selectedTask) : selectedTask}
            taskId={selectedTask?.id}
            onClose={() => setSelectedTask(null)}
            onStatusChange={handleStatusChange}
            onAddComment={handleAddComment}
            onEdit={handleEditTask}
            onDelete={handleDeleteTask}
            onMarkComplete={handleMarkComplete}
          />
        )}
      </Suspense>
    </>
  )
}
