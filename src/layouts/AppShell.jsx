import {Outlet} from 'react-router-dom'
import {Suspense, lazy, useCallback, useState} from 'react'
import OfflineBanner from '../components/OfflineBanner'
import {useDashboardContext} from '../context/DashboardContext'
import {useNotify} from '../lib/notify'
import DesktopSidebar from './DesktopSidebar'
import MobileNav from './MobileNav'
import TopBar from './TopBar'

const ConfirmDeleteTaskModal = lazy(() => import('../components/tasks/ConfirmDeleteTaskModal'))
const EditTaskModal = lazy(() => import('../components/tasks/EditTaskModal'))
const TaskDetailsDrawer = lazy(() => import('../components/tasks/TaskDetailsDrawer'))

export default function AppShell() {
  const {showToast} = useNotify()
  const {tasksById, updateTask, updateTaskStatus, deleteTask, addTaskComment} = useDashboardContext()
  const [selectedTask, setSelectedTask] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [deletingTask, setDeletingTask] = useState(null)

  const handleOpenTask = useCallback(task => {
    if (!task?.id) return
    setSelectedTask(task)
  }, [])

  const handleStatusChange = useCallback(async (taskId, status) => {
    await updateTaskStatus(taskId, status)
    showToast({type: 'success', message: 'Task status updated'})
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

  const handleMarkComplete = useCallback(async task => {
    if (!task?.id) return
    try {
      await updateTaskStatus(task.id, 'DONE')
      showToast({type: 'success', message: 'Task marked complete'})
    } catch (err) {
      showToast({type: 'error', message: err?.message || 'Task could not be completed'})
    }
  }, [showToast, updateTaskStatus])

  return (
    <div className="app-shell">
      <DesktopSidebar />
      <div className="app-main">
        <TopBar onOpenTask={handleOpenTask} />
        <OfflineBanner />
        <main className="screen" id="main-content">
          <Outlet />
        </main>
        <MobileNav />
      </div>
      <Suspense fallback={null}>
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
            onEdit={setEditingTask}
            onDelete={setDeletingTask}
            onMarkComplete={handleMarkComplete}
          />
        )}
      </Suspense>
    </div>
  )
}
