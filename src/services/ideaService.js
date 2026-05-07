import {callRPC} from './api'
import {clearDashboardCache} from './dashboardService'
import {getToken} from './authService'

export const IDEA_PRIORITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

function cleanList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function buildIdeaDescription(input = {}) {
  const description = String(input.description || '').trim()
  const why = String(input.why || input.why_this_matters || '').trim()
  const owner = String(input.suggested_owner || input.owner || '').trim()
  const priority = String(input.priority || 'MEDIUM').trim().toUpperCase()
  const tags = cleanList(input.tags)
  const sections = [description]

  if (why) sections.push(`Why this matters: ${why}`)
  if (owner) sections.push(`Suggested owner: ${owner}`)
  if (priority) sections.push(`Priority: ${priority}`)
  if (tags.length) sections.push(`Tags: ${tags.join(', ')}`)

  return sections.filter(Boolean).join('\n\n')
}

export function normalizeIdea(idea = {}) {
  const safeIdea = idea && typeof idea === 'object' && !Array.isArray(idea) ? idea : {}
  return {
    ...safeIdea,
    id: safeIdea.id,
    title: safeIdea.title || safeIdea.name || 'Untitled idea',
    description: safeIdea.description || safeIdea.summary || '',
    status: safeIdea.status || safeIdea.stage || safeIdea.decision_status || 'PENDING',
    submitted_by_name: safeIdea.submitted_by_name || safeIdea.owner_name || safeIdea.created_by_name || safeIdea.author || '',
    submitted_by_role: safeIdea.submitted_by_role || safeIdea.owner_role || '',
    created_at: safeIdea.created_at || safeIdea.createdAt || '',
    updated_at: safeIdea.updated_at || safeIdea.updatedAt || '',
    decision_note: safeIdea.decision_note || '',
    vote_count: Number(safeIdea.vote_count ?? safeIdea.votes ?? safeIdea.score ?? 0) || 0,
    discussion_count: Number(safeIdea.discussion_count ?? safeIdea.comment_count ?? safeIdea.comments_count ?? 0) || 0
  }
}

export async function submitIdea(input = {}) {
  const result = await callRPC('submit_idea_rpc', {
    p_token: getToken(),
    p_title: String(input.title || '').trim(),
    p_description: buildIdeaDescription(input)
  })
  clearDashboardCache()
  return result
}
