import { useState, useEffect, useMemo, Suspense, lazy } from 'react'
import ScreenLoader from '../components/ScreenLoader'
import Button from '../components/Button'
import Badge from '../components/Badge'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../lib/notify'
import {
  getAIInsights,
  generateAIReport,
  getAIReportHistory,
  acknowledgeInsight,
  formatInsightType,
  getSeverityColor,
  getSeverityLabel
} from '../services/insightsService'

const TEMPLATES = [
  { key: 'weekly_company', label: 'Weekly Company Report', desc: 'Company-wide operational summary', minRole: 'CEO' },
  { key: 'monthly_company', label: 'Monthly Company Report', desc: 'Comprehensive monthly analysis', minRole: 'CEO' },
  { key: 'department_summary', label: 'Department Summary', desc: 'Department-level health', minRole: 'FOUNDER' },
  { key: 'individual_review', label: 'Individual Review', desc: 'Per-member performance review', minRole: 'FOUNDER' }
]

function InsightCard({ insight, onAcknowledge }) {
  const severityVariant = getSeverityColor(insight.severity)
  const severityLabel = getSeverityLabel(insight.severity)
  const typeLabel = formatInsightType(insight.insight_type)

  return (
    <div className={`insight-card severity-${severityVariant}`}>
      <div className="insight-header">
        <div className="insight-badges">
          <Badge variant={severityVariant}>{severityLabel}</Badge>
          <Badge variant="default">{typeLabel}</Badge>
          {insight.target_department && (
            <Badge variant="outline">{insight.target_department}</Badge>
          )}
        </div>
        {!insight.acknowledged && onAcknowledge && (
          <button
            type="button"
            className="ack-btn"
            onClick={() => onAcknowledge(insight.id)}
            title="Acknowledge"
          >
            ✓
          </button>
        )}
        {insight.acknowledged && (
          <span className="ack-label">Acknowledged</span>
        )}
      </div>
      <h4 className="insight-title">{insight.title}</h4>
      <p className="insight-desc">{insight.description}</p>
      {insight.suggested_action && (
        <p className="insight-action">
          <strong>Suggested action:</strong> {insight.suggested_action}
        </p>
      )}
      {insight.task_id && insight.task_title && (
        <p className="insight-task">
          <strong>Task:</strong> {insight.task_title}
        </p>
      )}
      {insight.target_user_name && (
        <p className="insight-member">
          <strong>Member:</strong> {insight.target_user_name}
        </p>
      )}
      <small className="insight-date">
        {new Date(insight.created_at).toLocaleDateString()}
      </small>
    </div>
  )
}

function ReportCard({ report }) {
  const statusColor = {
    completed: 'success',
    running: 'warning',
    failed: 'danger',
    pending: 'default'
  }[report.status] || 'default'

  return (
    <div className="report-card">
      <div className="report-header">
        <strong>{report.template_name}</strong>
        <Badge variant={statusColor}>{report.status}</Badge>
      </div>
      <p className="report-meta">
        {report.initiated_by}
        {report.target_department && ` · ${report.target_department}`}
        {report.target_user_name && ` · ${report.target_user_name}`}
      </p>
      <p className="report-stats">
        {report.insight_count} insight(s) · {report.provider_used}
      </p>
      {report.summary && (
        <p className="report-summary">{report.summary}</p>
      )}
      <small className="report-date">
        {new Date(report.started_at).toLocaleDateString()}
        {report.completed_at && ` → ${new Date(report.completed_at).toLocaleDateString()}`}
      </small>
    </div>
  )
}

export default function ReportsScreen() {
  const { role } = useAuth()
  const { showToast } = useNotify()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [insights, setInsights] = useState([])
  const [reports, setReports] = useState([])
  const [generating, setGenerating] = useState(null)
  const [activeTab, setActiveTab] = useState('insights')

  const isCEO = role === 'CEO'
  const canSeeReports = role === 'CEO' || role === 'FOUNDER'
  const isIntern = role === 'INTERN'

  useEffect(() => {
    if (isIntern) {
      setLoading(false)
      return
    }
    loadData()
  }, [role])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [insightsResult, reportsResult] = await Promise.all([
        getAIInsights(50, false),
        canSeeReports ? getAIReportHistory(20) : Promise.resolve({ reports: [] })
      ])
      if (insightsResult.ok) setInsights(insightsResult.insights || [])
      if (reportsResult.ok) setReports(reportsResult.reports || [])
    } catch (err) {
      setError(err?.message || 'Failed to load insights')
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate(templateKey) {
    setGenerating(templateKey)
    try {
      const result = await generateAIReport(templateKey)
      if (result.ok) {
        showToast({ type: 'success', message: `${result.insight_count} insight(s) generated` })
        await loadData()
      } else {
        showToast({ type: 'error', message: result.error || 'Generation failed' })
      }
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Generation failed' })
    } finally {
      setGenerating(null)
    }
  }

  async function handleAcknowledge(insightId) {
    try {
      const result = await acknowledgeInsight(insightId)
      if (result.ok) {
        setInsights(prev => prev.map(i => i.id === insightId ? { ...i, acknowledged: true } : i))
        showToast({ type: 'success', message: 'Insight acknowledged' })
      }
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Failed to acknowledge' })
    }
  }

  const topRisks = useMemo(() =>
    insights.filter(i => i.severity >= 4 && !i.acknowledged).slice(0, 5),
    [insights]
  )
  const overdueInsights = useMemo(() =>
    insights.filter(i => i.insight_type === 'deadline_miss' && !i.acknowledged).slice(0, 5),
    [insights]
  )
  const inactiveInsights = useMemo(() =>
    insights.filter(i => i.insight_type === 'inactivity' && !i.acknowledged).slice(0, 5),
    [insights]
  )
  const burnoutInsights = useMemo(() =>
    insights.filter(i => i.insight_type === 'burnout_risk' && !i.acknowledged).slice(0, 5),
    [insights]
  )
  const deptInsights = useMemo(() =>
    insights.filter(i => i.insight_type === 'department_performance' && !i.acknowledged).slice(0, 3),
    [insights]
  )

  if (isIntern) {
    return (
      <>
        <header className="screen-header">
          <p className="eyebrow">Executive</p>
          <h1>Reports</h1>
        </header>
        <ScreenLoader
          loading={false}
          error=""
          isEmpty={true}
          emptyTitle="Company insights not available"
          emptyDescription="AI-powered reports are available to founders and leadership only."
        />
      </>
    )
  }

  return (
    <>
      <header className="screen-header">
        <div className="top">
          <div>
            <p className="eyebrow">Executive</p>
            <h1>AI Insights & Reports</h1>
            <p className="muted">Operational intelligence — advisory only, no automated actions.</p>
          </div>
        </div>
      </header>
      <ScreenLoader loading={loading} error={error} isEmpty={false} onRetry={loadData}>
        <div className="reports-layout">
          {/* Dashboard Summary */}
          <section className="panel insights-dashboard">
            <h2>Signal Overview</h2>
            <div className="dashboard-stats">
              <div className="dash-stat">
                <b>{topRisks.length}</b>
                <span>Critical Risks</span>
              </div>
              <div className="dash-stat">
                <b>{overdueInsights.length}</b>
                <span>Overdue Tasks</span>
              </div>
              <div className="dash-stat">
                <b>{inactiveInsights.length}</b>
                <span>Inactive Members</span>
              </div>
              <div className="dash-stat">
                <b>{burnoutInsights.length}</b>
                <span>Burnout Signals</span>
              </div>
              <div className="dash-stat">
                <b>{deptInsights.length}</b>
                <span>Dept Health</span>
              </div>
            </div>
          </section>

          {/* Generate Reports */}
          {isCEO && (
            <section className="panel generate-reports">
              <h2>Generate Report</h2>
              <div className="report-buttons">
                {TEMPLATES.filter(t => t.minRole === 'CEO').map(t => (
                  <Button
                    key={t.key}
                    variant="secondary"
                    onClick={() => handleGenerate(t.key)}
                    disabled={generating === t.key}
                  >
                    {generating === t.key ? 'Generating...' : t.label}
                  </Button>
                ))}
              </div>
            </section>
          )}

          {/* Tabs */}
          <div className="reports-tabs">
            <button
              type="button"
              className={`tab-btn ${activeTab === 'insights' ? 'active' : ''}`}
              onClick={() => setActiveTab('insights')}
            >
              All Insights ({insights.length})
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              Report History ({reports.length})
            </button>
          </div>

          {/* Insights Tab */}
          {activeTab === 'insights' && (
            <div className="insights-grid">
              {topRisks.length > 0 && (
                <div className="insight-section">
                  <h3>Critical Risks</h3>
                  {topRisks.map(insight => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      onAcknowledge={handleAcknowledge}
                    />
                  ))}
                </div>
              )}

              {overdueInsights.length > 0 && (
                <div className="insight-section">
                  <h3>Overdue Patterns</h3>
                  {overdueInsights.map(insight => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      onAcknowledge={handleAcknowledge}
                    />
                  ))}
                </div>
              )}

              {inactiveInsights.length > 0 && (
                <div className="insight-section">
                  <h3>Inactive Members</h3>
                  {inactiveInsights.map(insight => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      onAcknowledge={handleAcknowledge}
                    />
                  ))}
                </div>
              )}

              {burnoutInsights.length > 0 && (
                <div className="insight-section">
                  <h3>Burnout Risk Signals</h3>
                  {burnoutInsights.map(insight => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      onAcknowledge={handleAcknowledge}
                    />
                  ))}
                </div>
              )}

              {deptInsights.length > 0 && (
                <div className="insight-section">
                  <h3>Department Health</h3>
                  {deptInsights.map(insight => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      onAcknowledge={handleAcknowledge}
                    />
                  ))}
                </div>
              )}

              {insights.length === 0 && (
                <div className="empty-insights">
                  <p>No insights generated yet.</p>
                  {isCEO && (
                    <Button variant="primary" onClick={() => handleGenerate('weekly_company')}>
                      Generate Weekly Report
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="reports-history">
              {reports.length === 0 ? (
                <p className="muted">No reports generated yet.</p>
              ) : (
                reports.map(report => (
                  <ReportCard key={report.id} report={report} />
                ))
              )}
            </div>
          )}
        </div>
      </ScreenLoader>
    </>
  )
}