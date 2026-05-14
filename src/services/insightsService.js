import { callRPC } from './api'

export async function getAIInsights(limit = 50, includeAcknowledged = false) {
  return callRPC('get_ai_insights_rpc', { p_limit: limit, p_include_acknowledged: includeAcknowledged })
}

export async function generateAIReport(templateKey, targetUserId = null, targetDepartment = '') {
  return callRPC('generate_ai_report_rpc', {
    p_template_key: templateKey,
    p_target_user_id: targetUserId,
    p_target_department: targetDepartment
  })
}

export async function getAIReportHistory(limit = 20) {
  return callRPC('get_ai_report_history_rpc', { p_limit: limit })
}

export async function acknowledgeInsight(insightId) {
  return callRPC('acknowledge_insight_rpc', { p_insight_id: insightId })
}

export function formatInsightType(type) {
  const labels = {
    task_risk: 'Task Risk',
    deadline_miss: 'Deadline Miss',
    inactivity: 'Inactivity',
    productivity_trend: 'Productivity',
    burnout_risk: 'Burnout Risk',
    proof_quality: 'Proof Quality',
    department_performance: 'Department'
  }
  return labels[type] || type
}

export function getSeverityColor(severity) {
  if (severity >= 5) return 'danger'
  if (severity >= 4) return 'warning'
  if (severity >= 3) return 'caution'
  return 'info'
}

export function getSeverityLabel(severity) {
  if (severity >= 5) return 'Critical'
  if (severity >= 4) return 'High'
  if (severity >= 3) return 'Medium'
  return 'Low'
}