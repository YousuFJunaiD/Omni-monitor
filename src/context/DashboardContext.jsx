import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getDashboard, clearDashboardCache } from '../services/dashboardService'
import {
  normalizeIdea,
  submitIdea as submitIdeaRPC
} from '../services/ideaService'
import {
  addTaskComment as addTaskCommentRPC,
  createTask as createTaskRPC,
  deleteTask as deleteTaskRPC,
  normalizeTask,
  normalizeTaskStatus,
  updateTask as updateTaskRPC,
  updateTaskStatus as updateTaskStatusRPC
} from '../services/taskService'

const DashboardContext = createContext(null)
const EMPTY_ARRAY = Object.freeze([])
const EMPTY_OBJECT = Object.freeze({})

function asArray(value) {
  return Array.isArray(value) ? value : EMPTY_ARRAY
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : EMPTY_OBJECT
}

function normalizeDashboard(dashboard) {
  const source = asObject(dashboard)
  const me = asObject(source?.me || source?.user || source?.profile || source?.person)
  const taskList = asArray(source?.tasks || source?.task_list).map(normalizeTask)
  const tasksById = taskList.reduce((map, task) => {
    if (task?.id) map[task.id] = task
    return map
  }, {})
  const taskIds = taskList.map(task => task.id).filter(Boolean)

  return {
    raw: source,
    me,
    user: me,
    tasks: taskList,
    tasksById,
    taskIds,
    ideas: asArray(source?.ideas || source?.idea_list).map(normalizeIdea),
    visibleUsers: asArray(source?.visible_users || source?.users),
  }
}

export function useDashboardContext() {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error('useDashboardContext must be used within DashboardProvider')
  }
  return context
}

export function DashboardProvider({ children }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const requestIdRef = useRef(0)
  const taskMutationRef = useRef(new Map())

  const loadDashboard = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setError('')
    try {
      const result = await getDashboard()
      if (requestIdRef.current === requestId) {
        setData(result)
      }
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err?.message || 'Dashboard data could not be loaded')
        setData(current => current || null)
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard, refreshKey])

  const refresh = useCallback(() => {
    setLoading(!data)
    clearDashboardCache()
    setRefreshKey(prev => prev + 1)
  }, [data])

  const replaceTasks = useCallback(updater => {
    setData(current => {
      const source = asObject(current)
      const nextTasks = updater(asArray(source?.tasks || source?.task_list).map(normalizeTask))
      return {
        ...source,
        tasks: nextTasks
      }
    })
  }, [])

  const createTask = useCallback(async input => {
    const optimisticId = `optimistic-${Date.now()}`
    const visibleUsers = asArray(data?.visible_users || data?.users)
    const assigneeId = input.assigned_to || input.assignedTo || input.assignee_id
    const assignee = visibleUsers.find(user => user?.id === assigneeId)
    const optimisticTask = normalizeTask({
      id: optimisticId,
      title: input.title,
      details: input.details ?? input.description,
      assigned_to_id: assignee?.id || assigneeId,
      assigned_to: assignee?.name || 'Assigned teammate',
      assignee_role: assignee?.role,
      assignee_title: assignee?.title,
      priority: input.priority,
      status: 'TODO',
      due_date: input.due_date || input.dueDate,
      created_at: new Date().toISOString(),
      optimistic: true
    })

    replaceTasks(tasks => [optimisticTask, ...tasks])

    try {
      const result = await createTaskRPC(input)
      refresh()
      return result
    } catch (err) {
      replaceTasks(tasks => tasks.filter(task => task.id !== optimisticId))
      throw err
    }
  }, [data, refresh, replaceTasks])

  const updateTaskStatus = useCallback(async (taskId, status) => {
    const nextStatus = normalizeTaskStatus(status)
    const mutationId = (taskMutationRef.current.get(taskId) || 0) + 1
    let previousTask = null
    taskMutationRef.current.set(taskId, mutationId)

    replaceTasks(tasks => tasks.map(task => {
      if (task.id !== taskId) return task
      previousTask = task
      return normalizeTask({
        ...task,
        status: nextStatus,
        completed_at: nextStatus === 'DONE' ? new Date().toISOString() : task.completed_at
      })
    }))

    try {
      const result = await updateTaskStatusRPC(taskId, nextStatus)
      if (taskMutationRef.current.get(taskId) === mutationId) {
        refresh()
      }
      return result
    } catch (err) {
      if (previousTask && taskMutationRef.current.get(taskId) === mutationId) {
        replaceTasks(tasks => tasks.map(task => task.id === taskId ? previousTask : task))
      }
      throw err
    } finally {
      if (taskMutationRef.current.get(taskId) === mutationId) {
        taskMutationRef.current.delete(taskId)
      }
    }
  }, [refresh, replaceTasks])

  const updateTask = useCallback(async (taskId, updates) => {
    let previousTask = null
    const visibleUsers = asArray(data?.visible_users || data?.users)

    replaceTasks(tasks => tasks.map(task => {
      if (task.id !== taskId) return task
      previousTask = task
      const assigneeId = updates?.assigned_to || updates?.assignedTo || updates?.assignee_id || task.assignee?.id
      const assignee = visibleUsers.find(user => user?.id === assigneeId)
      return normalizeTask({
        ...task,
        ...updates,
        details: updates?.details ?? updates?.description ?? task.details,
        description: updates?.description ?? updates?.details ?? task.description,
        assigned_to_id: assigneeId,
        assigned_to: assignee?.name || task.assignee?.name || task.assigned_to,
        assignee_role: assignee?.role || task.assignee?.role,
        assignee_title: assignee?.title || task.assignee?.title
      })
    }))

    try {
      const result = await updateTaskRPC(taskId, updates)
      refresh()
      return result
    } catch (err) {
      if (previousTask) {
        replaceTasks(tasks => tasks.map(task => task.id === taskId ? previousTask : task))
      }
      throw err
    }
  }, [data, refresh, replaceTasks])

  const deleteTask = useCallback(async taskId => {
    let previousTasks = null
    replaceTasks(tasks => {
      previousTasks = tasks
      return tasks.filter(task => task.id !== taskId)
    })

    try {
      const result = await deleteTaskRPC(taskId)
      refresh()
      return result
    } catch (err) {
      if (previousTasks) replaceTasks(() => previousTasks)
      throw err
    }
  }, [refresh, replaceTasks])

  const addTaskComment = useCallback(async (taskId, note, options) => {
    const result = await addTaskCommentRPC(taskId, note, options)
    refresh()
    return result
  }, [refresh])

  const normalized = useMemo(() => normalizeDashboard(data), [data])
  const me = normalized.me
  const user = normalized.user
  const tasks = normalized.tasks
  const tasksById = normalized.tasksById
  const taskIds = normalized.taskIds
  const ideas = normalized.ideas
  const visibleUsers = normalized.visibleUsers

  const createIdea = useCallback(async input => {
    const optimisticId = `optimistic-idea-${Date.now()}`
    const optimisticIdea = normalizeIdea({
      id: optimisticId,
      title: input?.title,
      description: input?.description,
      status: 'PENDING',
      submitted_by_name: me?.name || 'You',
      submitted_by_role: me?.role,
      created_at: new Date().toISOString(),
      optimistic: true
    })

    setData(current => {
      const source = asObject(current)
      return {
        ...source,
        ideas: [optimisticIdea, ...asArray(source?.ideas || source?.idea_list).map(normalizeIdea)]
      }
    })

    try {
      const result = await submitIdeaRPC(input)
      refresh()
      return result
    } catch (err) {
      setData(current => {
        const source = asObject(current)
        return {
          ...source,
          ideas: asArray(source?.ideas || source?.idea_list).filter(idea => idea?.id !== optimisticId)
        }
      })
      throw err
    }
  }, [me?.name, me?.role, refresh])

  const value = useMemo(() => ({
    data: normalized.raw,
    dashboard: normalized.raw,
    me,
    user,
    tasks,
    tasksById,
    taskIds,
    ideas,
    visibleUsers,
    loading,
    error,
    refresh,
    createTask,
    updateTaskStatus,
    updateTask,
    deleteTask,
    addTaskComment,
    createIdea
  }), [normalized.raw, me, user, tasks, tasksById, taskIds, ideas, visibleUsers, loading, error, refresh, createTask, updateTaskStatus, updateTask, deleteTask, addTaskComment, createIdea])

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  )
}
