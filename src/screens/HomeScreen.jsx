import {Suspense, lazy, memo, useCallback, useMemo, useState} from 'react'
import Avatar from '../components/Avatar'
import Button from '../components/Button'
import EmptyState from '../components/EmptyState'
import OperationalActivityFeed from '../components/OperationalActivityFeed'
import StatusPill from '../components/StatusPill'
import TaskCard, { getStatusVariant } from '../components/TaskCard'
import {formatTaskStatus} from '../components/tasks/TaskCard'
import ScreenLoader from '../components/ScreenLoader'
import {useNotify} from '../lib/notify'
import {useDashboardContext} from '../context/DashboardContext'
import { getFirstName, getTitle } from '../lib/utils'

const CreateTaskModal = lazy(() => import('../components/tasks/CreateTaskModal'))
const ConfirmDeleteTaskModal = lazy(() => import('../components/tasks/ConfirmDeleteTaskModal'))
const EditTaskModal = lazy(() => import('../components/tasks/EditTaskModal'))
const TaskDetailsDrawer = lazy(() => import('../components/tasks/TaskDetailsDrawer'))

function isDone(task) {
  return String(task?.status || '').toUpperCase() === 'DONE'
}

function isAssignedTo(task, user) {
  if (!user) return false
  const assigneeId = task?.assignee?.id || task?.assigned_to_id || task?.assignee_id
  const assigneeName = task?.assignee?.name || task?.assigned_to
  return Boolean(
    (user?.id && assigneeId && String(user.id) === String(assigneeId)) ||
    (user?.name && assigneeName && String(user.name).toLowerCase() === String(assigneeName).toLowerCase())
  )
}

function daysUntilDue(task) {
  const value = task?.due_date || task?.dueDate
  if (!value) return null
  const due = new Date(value)
  if (Number.isNaN(due.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  return Math.round((due - today) / 86400000)
}

function sortRecent(a, b) {
  return new Date(b?.updated_at || b?.updatedAt || b?.created_at || 0) - new Date(a?.updated_at || a?.updatedAt || a?.created_at || 0)
}

const TaskPreviewItem = memo(function TaskPreviewItem({className = '', task, onClick, onOpenDetails, onEdit, onDelete, onMarkComplete}) {
  return (
    <TaskCard
      className={className}
      task={task}
      onClick={onClick}
      onOpenDetails={onOpenDetails}
      onEdit={onEdit}
      onDelete={onDelete}
      onMarkComplete={onMarkComplete}
    />
  )
})

export default function HomeScreen() {
  const {showToast} = useNotify()
  const {me, tasks, tasksById, visibleUsers, loading, error, refresh, createTask, updateTask, updateTaskStatus, deleteTask, addTaskComment} = useDashboardContext()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [deletingTask, setDeletingTask] = useState(null)
  const safeTasks = Array.isArray(tasks) ? tasks : []

  const title = useMemo(() => getTitle(me), [me])
  const previewTasks = useMemo(() => safeTasks.slice(0, 3), [safeTasks])
  const pendingTasks = useMemo(() => (
    safeTasks.filter(task => !String(task?.status || '').toLowerCase().match(/done|complete|approved/))
  ), [safeTasks])
  const assignedToYou = useMemo(() => pendingTasks.filter(task => isAssignedTo(task, me)), [me, pendingTasks])
  const needsReview = useMemo(() => safeTasks.filter(task => String(task?.status || '').toUpperCase() === 'SUBMITTED'), [safeTasks])
  const overdueTasks = useMemo(() => pendingTasks.filter(task => daysUntilDue(task) < 0), [pendingTasks])
  const blockedTasks = useMemo(() => safeTasks.filter(task => String(task?.status || '').toUpperCase() === 'BLOCKED'), [safeTasks])
  const recentlyUpdated = useMemo(() => [...safeTasks].sort(sortRecent).slice(0, 4), [safeTasks])
  const attentionTasks = useMemo(() => {
    const seen = new Set()
    return [...blockedTasks, ...overdueTasks, ...needsReview, ...assignedToYou, ...pendingTasks]
      .filter(task => {
        if (!task?.id || seen.has(task.id) || isDone(task)) return false
        seen.add(task.id)
        return true
      })
      .slice(0, 5)
  }, [assignedToYou, blockedTasks, needsReview, overdueTasks, pendingTasks])
  const nextTask = attentionTasks[0]
  const pendingCount = pendingTasks.length
  const workflowSections = useMemo(() => ([
    ['Assigned to you', assignedToYou],
    ['Needs review', needsReview],
    ['Overdue', overdueTasks],
    ['Blocked tasks', blockedTasks]
  ]), [assignedToYou, blockedTasks, needsReview, overdueTasks])

  const handleCreateTask = useCallback(() => {
    setCreateOpen(true)
  }, [])

  const handleViewAll = useCallback(() => {
    setSelectedTask(nextTask || attentionTasks[0] || previewTasks[0] || null)
  }, [attentionTasks, nextTask, previewTasks])

  const handleSubmitTask = useCallback(async input => {
    await createTask(input)
    setCreateOpen(false)
    showToast({type: 'success', message: 'Task created'})
  }, [createTask, showToast])

  const handleStatusChange = useCallback(async (taskId, status) => {
    await updateTaskStatus(taskId, status)
    showToast({type: 'success', message: 'Task status updated'})
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

  const handleEditTask = useCallback(task => setEditingTask(task), [])
  const handleDeleteTask = useCallback(task => setDeletingTask(task), [])

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
            <p className="eyebrow">Dashboard</p>
            <h1>Welcome back, {getFirstName(me?.name)}</h1>
            <p className="muted">Your highest-impact work, team signals, and next actions in one place.</p>
            <p className="dashboard-summary">{attentionTasks.length} attention signals active</p>
          </div>
          <Button variant="primary" onClick={handleCreateTask}>
            Create Task
          </Button>
        </div>
      </header>
      <ScreenLoader loading={loading} error={error} isEmpty={false} onRetry={refresh}>
        <div className="layout">
          <div className="stack">
            <section className="panel hero-panel">
              <div className="person hero-person">
                <div>
                  <p className="eyebrow">Today</p>
                  <h2>{pendingCount ? `${pendingCount} tasks need attention` : 'Your queue is clear'}</h2>
                  <p className="muted">{title}</p>
                </div>
                <Avatar user={me} size={72} />
              </div>
              <div className="hero-actions">
                <Button variant="primary" onClick={handleCreateTask}>
                  Create Task
                </Button>
                <Button variant="secondary" onClick={handleViewAll}>
                  Review queue
                </Button>
              </div>
            </section>
            <section className="panel stats-panel stats ops-stats">
              <button className="stat stat-button" type="button" onClick={() => setSelectedTask(assignedToYou[0] || null)}>
                <div className="stat-icon">T</div>
                <div>
                  <b>{assignedToYou.length}</b>
                  <span>Assigned to you</span>
                </div>
              </button>
              <button className="stat stat-button" type="button" onClick={() => setSelectedTask(needsReview[0] || null)}>
                <div className="stat-icon">R</div>
                <div>
                  <b>{needsReview.length}</b>
                  <span>Needs review</span>
                </div>
              </button>
              <button className="stat stat-button danger-stat" type="button" onClick={() => setSelectedTask(overdueTasks[0] || null)}>
                <div className="stat-icon">O</div>
                <div>
                  <b>{overdueTasks.length}</b>
                  <span>Overdue</span>
                </div>
              </button>
              <button className="stat stat-button danger-stat" type="button" onClick={() => setSelectedTask(blockedTasks[0] || null)}>
                <div className="stat-icon">B</div>
                <div>
                  <b>{blockedTasks.length}</b>
                  <span>Blocked</span>
                </div>
              </button>
            </section>
            <section className="panel workflow-lanes-panel">
              <div className="section-title">
                <h2>Operations board</h2>
              </div>
              <div className="workflow-lanes">
                {workflowSections.map(([label, sectionTasks]) => (
                  <section className="workflow-lane" key={label}>
                    <div className="workflow-lane-header">
                      <h3>{label}</h3>
                      <span>{sectionTasks.length}</span>
                    </div>
                    {sectionTasks.length === 0 ? (
                      <p className="muted">Clear</p>
                    ) : (
                      sectionTasks.slice(0, 3).map(task => (
                        <button key={task?.id || task?.title} type="button" onClick={() => setSelectedTask(task)}>
                          <strong>{task?.title || 'Untitled task'}</strong>
                          <small>{task?.assignee?.name || task?.assigned_to || 'Unassigned'}</small>
                        </button>
                      ))
                    )}
                  </section>
                ))}
              </div>
            </section>
            <section className="panel next-action-panel">
              <div>
                <p className="eyebrow">You should do this next</p>
                <h2>{nextTask ? (nextTask?.title || nextTask?.name || 'Review the top task') : 'Create a task with a clear owner'}</h2>
                <p className="muted">
                  {nextTask
                    ? (nextTask?.description || nextTask?.summary || 'This is the highest-signal item in your queue right now.')
                    : 'Start with one concrete outcome so the workspace has a useful next move.'}
                </p>
              </div>
              <div className="next-action-footer">
                {nextTask && (
                    <StatusPill variant={getStatusVariant(nextTask?.status)}>
                    {formatTaskStatus(nextTask?.status)}
                  </StatusPill>
                )}
                <Button variant="primary" onClick={nextTask ? handleViewAll : handleCreateTask}>
                  {nextTask ? 'Review task' : 'Create Task'}
                </Button>
              </div>
            </section>
          </div>
          <aside className="stack">
            <section className="panel preview-panel">
              <div className="section-title">
                <h2>Attention queue</h2>
                <Button variant="ghost" onClick={handleViewAll}>
                  View all
                </Button>
              </div>
              {attentionTasks.length === 0 ? (
                <EmptyState
                  title="No pending work needs attention."
                  description="Create a task to give the team a clear owner, outcome, and next step."
                  action={
                    <Button variant="primary" onClick={handleCreateTask}>
                      Create Task
                    </Button>
                  }
                />
              ) : (
                attentionTasks.map((task, index) => (
                  <TaskPreviewItem
                    className={index === 0 ? 'priority-task' : ''}
                    key={task?.id ?? task?.title ?? index}
                    task={task}
                    onClick={() => setSelectedTask(task)}
                    onOpenDetails={() => setSelectedTask(task)}
                    onEdit={handleEditTask}
                    onDelete={handleDeleteTask}
                    onMarkComplete={handleMarkComplete}
                  />
                ))
              )}
            </section>
            <section className="panel activity-panel">
              <div className="section-title">
                <h2>Team activity</h2>
              </div>
              <OperationalActivityFeed
                tasks={recentlyUpdated}
                limit={5}
                onOpenTask={setSelectedTask}
                emptyAction={<Button variant="secondary" onClick={handleCreateTask}>Create Task</Button>}
              />
            </section>
          </aside>
        </div>
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
