import {callRPC} from './api'
import {clearDashboardCache} from './dashboardService'
import {getToken} from './authService'

export const TASK_STATUSES = Object.freeze(['TODO', 'IN_PROGRESS', 'SUBMITTED', 'DONE', 'BLOCKED'])
export const TASK_PRIORITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

export function normalizeTaskStatus(status) {
  const normalized = String(status || 'TODO').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (normalized === 'REVIEW') return 'SUBMITTED'
  return TASK_STATUSES.includes(normalized) ? normalized : 'TODO'
}

export function normalizeTask(task = {}) {
  const safeTask = task && typeof task === 'object' && !Array.isArray(task) ? task : {}
  const assigneeName = safeTask.assignee?.name || safeTask.assigned_to_name || safeTask.assigned_to || ''
  const creatorName = safeTask.creator?.name || safeTask.assigned_by_name || safeTask.created_by || safeTask.assigned_by || ''

  return {
    ...safeTask,
    id: safeTask.id,
    title: safeTask.title || safeTask.name || 'Untitled task',
    description: safeTask.description ?? safeTask.details ?? safeTask.summary ?? '',
    details: safeTask.details ?? safeTask.description ?? safeTask.summary ?? '',
    status: normalizeTaskStatus(safeTask.status),
    priority: String(safeTask.priority || 'MEDIUM').toUpperCase(),
    due_date: safeTask.due_date || safeTask.dueDate || '',
    created_at: safeTask.created_at || safeTask.createdAt || '',
    completed_at: safeTask.completed_at || safeTask.completedAt || '',
    assignee: {
      id: safeTask.assignee?.id || safeTask.assigned_to_id || safeTask.assignee_id || safeTask.assigned_to || '',
      name: assigneeName,
      role: safeTask.assignee?.role || safeTask.assignee_role || safeTask.assigned_to_role || '',
      title: safeTask.assignee?.title || safeTask.assignee_title || ''
    },
    creator: {
      id: safeTask.creator?.id || safeTask.assigned_by_id || safeTask.creator_id || '',
      name: creatorName,
      role: safeTask.creator?.role || safeTask.assigned_by_role || '',
      title: safeTask.creator?.title || ''
    }
  }
}

function taskPayload(input = {}) {
  return {
    p_token: getToken(),
    p_title: String(input.title || '').trim(),
    p_details: String(input.details ?? input.description ?? '').trim(),
    p_assigned_to: input.assigned_to || input.assignedTo || input.assignee_id,
    p_priority: String(input.priority || 'MEDIUM').toUpperCase(),
    p_due_date: input.due_date || input.dueDate || null
  }
}

function clearTaskReadModel() {
  clearDashboardCache()
}

export async function createTask(input) {
  const result = await callRPC('create_task_rpc', taskPayload(input))
  clearTaskReadModel()
  return result
}

export async function updateTask(taskId, updates = {}) {
  if (updates.status && Object.keys(updates).every(key => ['status'].includes(key))) {
    return updateTaskStatus(taskId, updates.status)
  }

  const currentTask = await getTaskById(taskId)
  const dueDate = (updates.due_date ?? updates.dueDate ?? currentTask.due_date) || null
  const result = await callRPC('update_task_rpc', {
    p_token: getToken(),
    p_task_id: taskId,
    p_title: updates.title ?? currentTask.title,
    p_details: updates.details ?? updates.description ?? currentTask.details,
    p_assigned_to: updates.assigned_to || updates.assignedTo || updates.assignee_id || currentTask.assignee?.id,
    p_priority: updates.priority ? String(updates.priority).toUpperCase() : currentTask.priority,
    p_due_date: dueDate
  })
  clearTaskReadModel()
  return result
}

export async function deleteTask(taskId) {
  const result = await callRPC('delete_task_rpc', {
    p_token: getToken(),
    p_task_id: taskId
  })
  clearTaskReadModel()
  return result
}

export async function getTaskById(taskId, {forceRefresh = false} = {}) {
  if (forceRefresh) clearTaskReadModel()
  const result = await callRPC('get_task_by_id_rpc', {
    p_token: getToken(),
    p_task_id: taskId
  })
  const task = result?.data

  if (!task) {
    throw new Error('Task not found')
  }

  return normalizeTask(task)
}

export async function updateTaskStatus(taskId, status) {
  const result = await callRPC('update_task_status_rpc', {
    p_token: getToken(),
    p_task_id: taskId,
    p_status: normalizeTaskStatus(status)
  })
  clearTaskReadModel()
  return result
}

export async function addTaskComment(taskId, note) {
  const body = String(note || '').trim()
  const result = await callRPC('add_task_comment_rpc', {
    p_token: getToken(),
    p_task_id: taskId,
    p_body: body
  })
  clearTaskReadModel()
  return result
}

function normalizeComment(comment = {}) {
  return {
    id: comment.id,
    taskId: comment.task_id,
    author: comment.user_name || comment.user || 'Team member',
    body: comment.body || comment.note || '',
    createdAt: comment.created_at,
    isSubmission: Boolean(comment.is_submission)
  }
}

export async function getTaskComments(taskId, {cursor = null, limit = 20, forceRefresh = false} = {}) {
  if (forceRefresh) clearTaskReadModel()
  const result = await callRPC('get_task_comments_rpc', {
    p_token: getToken(),
    p_task_id: taskId
  })
  const allItems = (Array.isArray(result?.data) ? result.data : []).map(normalizeComment)
  const start = cursor ? Math.max(0, allItems.findIndex(item => item?.id === cursor) + 1) : 0
  const pageSize = Math.max(1, Number(limit) || 20)
  const items = allItems.slice(start, start + pageSize)
  const nextItem = allItems[start + pageSize]

  return {
    items,
    nextCursor: nextItem?.id || null,
    hasMore: Boolean(nextItem)
  }
}

export async function getActivityTimeline(taskId, {forceRefresh = false} = {}) {
  if (forceRefresh) clearTaskReadModel()
  const result = await callRPC('get_activity_timeline_rpc', {
    p_token: getToken(),
    p_limit: 50,
    p_task_id: taskId
  })

  return (Array.isArray(result?.data) ? result.data : [])
    .map(item => ({
      id: item.id,
      type: String(item.event_type || 'EVENT').toLowerCase(),
      label: humanizeActivityType(item.event_type),
      body: item.body || humanizeActivityType(item.event_type),
      actor: item.actor_name || '',
      createdAt: item.created_at
    }))
    .filter(item => item.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

function humanizeActivityType(type) {
  const normalized = String(type || 'EVENT').toUpperCase()
  const labels = {
    TASK_CREATED: 'Task created',
    TASK_ASSIGNED: 'Assigned',
    TASK_UPDATED: 'Task updated',
    STATUS_CHANGED: 'Status changed',
    TASK_COMPLETED: 'Completed',
    COMMENT_ADDED: 'Comment added',
    WORK_SUBMITTED: 'Work submitted',
    TASK_DELETED: 'Task deleted'
  }
  return labels[normalized] || normalized.replace(/_/g, ' ').toLowerCase().replace(/^\w/, char => char.toUpperCase())
}
