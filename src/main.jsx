import React, {useEffect, useMemo, useRef, useState, useCallback, memo} from 'react'
import {createRoot} from 'react-dom/client'
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Bell,
  CalendarDays,
  Camera,
  CheckCircle,
  ChevronDown,
  ClipboardList,
  Clock,
  Download,
  Edit2,
  Flame,
  Home,
  Info,
  Lightbulb,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
  Trophy,
  Upload,
  Users,
  X,
  Zap
} from 'lucide-react'
import {supabase, supabaseReady} from './supabase'
import './styles.css'

const TOKEN_KEY = 'omnimate_session_token'
const LEGACY_TOKEN_KEY = 'omnimart_session_token'
const emptyDash = {
  me: null, visible_users: [], founder_ranking: [], intern_ranking: [],
  proof_feed: [], ideas: [], attention_overdue: [], attention_needs_review: [],
  attention_blocked: [], recent_activity: [], unread_notifications: 0
}
const ideaStatuses = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS', 'REJECTED']
const taskStatuses = ['ALL', 'TODO', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'RESUBMITTED', 'REJECTED', 'DONE', 'BLOCKED']
const FRONTEND_INTERN_USERNAMES = new Set(['aarzoo.anna', 'ruqiya.n', 'mazen.ahmed', 'polok.k', 'syed.firas', 'lotifur.r'])
const BACKEND_INTERN_USERNAMES = new Set(['akshaya.r', 'ismail.q', 'mazharuddin.s'])

// ─── Utilities ───────────────────────────────────────────────────────────────

async function rpc(name, args) {
  if (!supabaseReady) throw new Error('Add Supabase keys in .env.local')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  if (data?.ok === false) throw new Error(data.error || 'Request failed')
  return data
}

async function requestAiAnalysis(context) {
  const response = await fetch('/api/ai-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context })
  })
  if (!response.ok) return { ok: false, error: `AI API failed: ${response.status}` }
  return response.json()
}

function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

function isOverdue(task) {
  return task.due_date && !['DONE', 'APPROVED', 'REJECTED'].includes(task.status) && new Date(`${task.due_date}T23:59:59`) < new Date()
}

function isDueSoon(task) {
  if (!task.due_date || ['DONE', 'APPROVED', 'REJECTED'].includes(task.status)) return false
  const due = new Date(`${task.due_date}T23:59:59`)
  const now = new Date()
  const twoDays = 2 * 24 * 60 * 60 * 1000
  return due >= now && (due - now) <= twoDays
}

function niceDate(date) {
  if (!date) return '—'
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const dy = Math.floor(hr / 24)
  if (dy < 7) return `${dy}d ago`
  return niceDate(dateStr)
}

function displayRole(role) {
  const normalized = String(role || '').trim().toUpperCase()
  if (normalized === 'CEO') return 'CEO'
  if (normalized === 'FOUNDER' || normalized === 'BOARD') return 'Founding Member'
  if (normalized === 'INTERN') return 'Intern'
  return role ? String(role).replace(/_/g, ' ').toLowerCase().replace(/^\w/, char => char.toUpperCase()) : ''
}

function displayStatusBadge(status) {
  const map = {
    TODO: 'todo',
    IN_PROGRESS: 'in_progress',
    SUBMITTED: 'submitted',
    UNDER_REVIEW: 'submitted',
    APPROVED: 'done',
    CHANGES_REQUESTED: 'blocked',
    RESUBMITTED: 'submitted',
    REJECTED: 'blocked',
    DONE: 'done',
    BLOCKED: 'blocked'
  }
  return map[status] || 'todo'
}

function priorityClass(p) {
  return { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', URGENT: 'urgent' }[p] || 'medium'
}

function taskStatusOptionsFor(user = {}, task = {}) {
  if (user.role === 'CEO') return taskStatuses.filter(s => s !== 'ALL')
  if (task.assigned_to_id === user.id && task.status === 'APPROVED') return ['APPROVED', 'DONE']
  if (task.assigned_to_id === user.id) return ['TODO', 'IN_PROGRESS', 'SUBMITTED', 'BLOCKED']
  return [task.status || 'TODO']
}

function isAuthExpiredError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return message.includes('unauthorized')
    || message.includes('invalid token')
    || message.includes('expired')
    || message.includes('session')
}

function userDepartment(user = {}) {
  const username = String(user.username || '').toLowerCase()
  const title = String(user.title || '').toLowerCase()
  if (FRONTEND_INTERN_USERNAMES.has(username) || title.includes('frontend') || /\b(cpo|cxo)\b/.test(title)) return 'frontend'
  if (BACKEND_INTERN_USERNAMES.has(username) || title.includes('backend') || /\b(cto|csa)\b/.test(title)) return 'backend'
  return ''
}

function canAssignToUser(manager = {}, target = {}) {
  const managerRole = String(manager.role || '').toUpperCase()
  const targetRole = String(target.role || '').toUpperCase()
  if (!target?.id || targetRole === 'CEO') return false
  if (managerRole === 'CEO') return true
  if (managerRole !== 'FOUNDER' && managerRole !== 'BOARD') return false
  return targetRole === 'INTERN' && userDepartment(manager) && userDepartment(manager) === userDepartment(target)
}

function canManageInternForUser(manager = {}, intern = {}) {
  const managerRole = String(manager.role || '').toUpperCase()
  if (managerRole === 'CEO') return true
  if (managerRole !== 'FOUNDER' && managerRole !== 'BOARD') return false
  return String(intern.role || '').toUpperCase() === 'INTERN' && userDepartment(manager) && userDepartment(manager) === userDepartment(intern)
}

function arrayFromRpc(result, keys = []) {
  if (Array.isArray(result)) return result
  if (!result || typeof result !== 'object') return []

  for (const key of keys) {
    if (Array.isArray(result[key])) return result[key]
  }

  if (result.data && typeof result.data === 'object') {
    const nested = arrayFromRpc(result.data, keys)
    if (nested.length) return nested
  }

  return []
}

function objectFromRpc(result) {
  if (!result || typeof result !== 'object') return null
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) return result.data
  return result
}

function normalizeTaskForUi(task) {
  const safe = task && typeof task === 'object' && !Array.isArray(task) ? task : {}
  return {
    ...safe,
    id: safe.id || '',
    title: safe.title || safe.name || 'Untitled task',
    details: safe.details ?? safe.description ?? '',
    status: String(safe.status || 'TODO').toUpperCase().replace(/[\s-]+/g, '_'),
    priority: String(safe.priority || 'MEDIUM').toUpperCase(),
    due_date: safe.due_date || safe.dueDate || '',
    created_at: safe.created_at || safe.createdAt || '',
    assigned_to_id: safe.assigned_to_id || safe.assignee_id || safe.assignee?.id || '',
    assigned_to: safe.assigned_to || safe.assigned_to_name || safe.assignee?.name || 'Unassigned',
    assignee_role: safe.assignee_role || safe.assigned_to_role || safe.assignee?.role || '',
    assigned_by_id: safe.assigned_by_id || safe.creator?.id || '',
    assigned_by_name: safe.assigned_by_name || safe.assigned_by || safe.creator?.name || '',
    proof_count: Number(safe.proof_count ?? (Array.isArray(safe.proofs) ? safe.proofs.length : 0)) || 0,
    minutes: Number(safe.minutes ?? safe.minutes_logged ?? 0) || 0,
    comments: Array.isArray(safe.comments) ? safe.comments : [],
    proofs: Array.isArray(safe.proofs) ? safe.proofs : []
  }
}

class TabErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('Tab render error:', error)
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="tasks-empty">
          <AlertCircle size={32} className="tasks-empty-icon" />
          <b>{this.props.message || 'Unable to load this section.'}</b>
          <p>Please refresh or contact admin.</p>
        </div>
      )
    }

    return this.props.children
  }
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('App render error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-fallback">
          <AlertCircle size={34} />
          <b>Something went wrong.</b>
          <p>The workspace could not render safely. Refresh or sign in again.</p>
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }

    return this.props.children
  }
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div className={`toast toast-${type}`}>
      {type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
      <span>{message}</span>
      <button className="toast-close" onClick={onDismiss}><X size={14} /></button>
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

const emptyStateHints = {
  'No proofs yet': 'Proof activity will appear here as work is submitted.',
  'No ideas yet': 'Submitted ideas and decisions will collect here.',
  'No notifications': 'New approvals, updates, and system notices will appear here.',
}

function Empty({ text, icon }) {
  const hint = emptyStateHints[text]

  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <span>{text}</span>
      {hint && <p>{hint}</p>}
    </div>
  )
}

// ─── Login ───────────────────────────────────────────────────────────────────

function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const data = await rpc('login_user', { p_username: username, p_password: password })
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.removeItem(LEGACY_TOKEN_KEY)
      onLogin(data.token)
    } catch (ex) { setErr(ex.message) }
    finally { setLoading(false) }
  }
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">OM</div>
          <div className="brand-text">
            <h1>Omnimate</h1>
            <p>Execution OS</p>
          </div>
        </div>
        <p className="login-desc">Private workspace for the team.</p>
        {!supabaseReady && (
          <div className="notice notice-warn">
            <Info size={14} />
            Add Supabase keys in <code>.env.local</code> first.
          </div>
        )}
        <form onSubmit={submit}>
          <div className="field">
            <label>Username</label>
            <input className="input" value={username} onChange={e => setUsername(e.target.value.toLowerCase())}
              placeholder="your_username" autoComplete="username" />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete="current-password" />
          </div>
          {err && <p className="form-error">{err}</p>}
          <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Navigation ──────────────────────────────────────────────────────────────

const NAV = [
  { id: 'home',   label: 'Home',   icon: Home },
  { id: 'tasks',  label: 'Tasks',  icon: ClipboardList },
  { id: 'ideas',  label: 'Ideas',  icon: Lightbulb },
  { id: 'team',   label: 'Team',   icon: Users },
  { id: 'more',   label: 'More',   icon: MoreHorizontal },
]

function NavBar({ tab, setTab, me, unreadNotif, onLogout }) {
  const currentPage = NAV.find(n => n.id === tab)?.label || 'Home'

  return (
    <nav className="navbar" aria-label="Primary navigation">
      <div className="nav-brand">
        <div className="nav-logo">OM</div>
        <div className="nav-brand-copy">
          <span className="nav-title">Omnimate Monitor</span>
          <span className="nav-subtitle">Execution control</span>
        </div>
      </div>
      <div className="mobile-app-title" aria-live="polite">
        <span>{currentPage}</span>
        {unreadNotif > 0 && <b>{unreadNotif}</b>}
      </div>
      <div className="nav-context" aria-label="Workspace">
        <span>Workspace</span>
        <strong>{me?.title || 'Operations'}</strong>
      </div>
      <span className="nav-group-label">Operate</span>
      <div className="nav-items">
        {NAV.map(n => (
          <button key={n.id} type="button" aria-current={tab === n.id ? 'page' : undefined}
            className={`nav-item ${tab === n.id ? 'active' : ''}`} onClick={() => setTab(n.id)}>
            <n.icon size={17} />
            <span>{n.label}</span>
            {n.id === 'more' && unreadNotif > 0 && <span className="nav-badge">{unreadNotif}</span>}
          </button>
        ))}
      </div>
      <div className="nav-user">
        <div className="user-info">
          <span className="user-name">{me?.name?.split(' ')[0]}</span>
          <span className="user-role">{displayRole(me?.role)}</span>
        </div>
        <button className="icon-btn" type="button" onClick={onLogout} title="Logout" aria-label="Logout"><LogOut size={16} /></button>
      </div>
    </nav>
  )
}

// ─── App Root ────────────────────────────────────────────────────────────────

function App() {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || '')
  const [dash, setDash] = useState(emptyDash)
  const [tab, setTab] = useState('home')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [booting, setBooting] = useState(Boolean(localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY)))
  const [toast, setToast] = useState(null)

  async function load() {
    if (!token) {
      setBooting(false)
      return
    }
    setLoading(true)
    setErr('')
    try {
      const data = await rpc('get_dashboard', { p_token: token })
      setDash(data)
    } catch (ex) {
      setErr(ex.message)
      if (isAuthExpiredError(ex)) {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(LEGACY_TOKEN_KEY)
        setToken('')
        setDash(emptyDash)
      }
    } finally {
      setLoading(false)
      setBooting(false)
    }
  }

  useEffect(() => { load() }, [token])

  function notify(msg, type = 'success') {
    setToast({ message: msg, type })
  }

  async function logout() {
    try { await rpc('logout_user', { p_token: token }) } catch {}
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    setToken('')
    setDash(emptyDash)
  }

  if (booting) {
    return (
      <div className="app-boot">
        <div className="screen-loader" />
        <b>Restoring session...</b>
        <p className="muted">Loading your workspace securely.</p>
      </div>
    )
  }

  if (!token) return <Login onLogin={setToken} />

  return (
    <div className="app-shell">
      <NavBar tab={tab} setTab={setTab} me={dash.me} unreadNotif={dash.unread_notifications || 0} onLogout={logout} />
      <main className="app-content">
        {err && <div className="notice notice-error">{err}</div>}
        {loading && <div className="loading-bar"><span /></div>}
        <TabErrorBoundary resetKey={tab} message={tab === 'tasks' ? 'Unable to load tasks.' : 'Unable to load this section.'}>
          {tab === 'home'   && <HomeTab   dash={dash} token={token} me={dash.me} reload={load} notify={notify} />}
          {tab === 'tasks' && <TasksTab  dash={dash} token={token} me={dash.me} reload={load} notify={notify} />}
          {tab === 'ideas' && <IdeasTab  dash={dash} token={token} me={dash.me} reload={load} notify={notify} />}
          {tab === 'team'  && <TeamTab   dash={dash} token={token} me={dash.me} reload={load} notify={notify} />}
          {tab === 'more'  && <MoreTab   dash={dash} token={token} me={dash.me} reload={load} notify={notify} />}
        </TabErrorBoundary>
      </main>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  )
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

// Phase 7: memoized — stable props from parent useMemo'd derivations.
const StatCard = memo(function StatCard({ icon, label, value, accent }) {
  return (
    <div className={`stat-card ${accent ? 'stat-accent' : ''}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <b className="stat-value">{value ?? 0}</b>
        <span className="stat-label">{label}</span>
      </div>
    </div>
  )
})

// ─── Section Header ──────────────────────────────────────────────────────────

function SectionHead({ icon, title, action }) {
  return (
    <div className="section-head">
      <div className="section-title-row">
        {icon && <span className="section-icon">{icon}</span>}
        <h2>{title}</h2>
      </div>
      {action && <div className="section-action">{action}</div>}
    </div>
  )
}

// ─── Badge ───────────────────────────────────────────────────────────────────

function Badge({ children, variant = 'default' }) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}

function StrikeBadge({ count = 0 }) {
  return count > 0
    ? <span className={`badge badge-strike ${count >= 3 ? 'badge-danger' : ''}`}>⚡ {count}</span>
    : null
}

// ─── HOME TAB (role dispatcher) ──────────────────────────────────────────────
// Phase 6: role-specific dashboards. Production entry — see FRONTEND_ARCHITECTURE.md.
// Dispatches to CEO / Founder / Intern views based on me.role. Each view reuses
// existing rpc() helper and the get_dashboard payload already loaded by App().
// No new SQL — only frontend composition over Phases 1–5 RPCs.

function HomeTab({ dash, token, me, reload, notify }) {
  const role = String(me?.role || '').toUpperCase()
  if (role === 'CEO') {
    return <CeoHomeView dash={dash} token={token} me={me} reload={reload} notify={notify} />
  }
  if (role === 'FOUNDER' || role === 'BOARD') {
    return <FounderHomeView dash={dash} token={token} me={me} reload={reload} notify={notify} />
  }
  // INTERN or anything unrecognized → intern execution view (least-privilege fallback)
  return <InternHomeView dash={dash} token={token} me={me} reload={reload} notify={notify} />
}

// ── Shared helpers for role views ────────────────────────────────────────────

function useActivityFeed(token, { limit = 25 } = {}) {
  // Phase 7: default limit reduced from 50 → 25 (still paginated via Load more).
  // Phase 7: mountedRef gates setState so fast tab switches don't warn.
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async ({ off = 0, append = false } = {}) => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const data = await rpc('get_activity_feed_rpc', { p_token: token, p_limit: limit, p_offset: off })
      if (!mountedRef.current) return
      const next = arrayFromRpc(data, ['items', 'data', 'activity'])
      setItems(prev => append ? [...prev, ...next] : next)
      setOffset(off + next.length)
      setHasMore(next.length === limit)
    } catch (ex) {
      if (mountedRef.current) setError(ex.message || 'Unable to load activity')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [token, limit])

  useEffect(() => { load({ off: 0 }) }, [load])

  return { items, loading, error, hasMore, offset, load }
}

function useAiInsights(token, role) {
  // Interns must not call this — server-side returns empty for INTERN, but skip
  // the round-trip entirely as a client-side RBAC guard.
  const [insights, setInsights] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    if (String(role || '').toUpperCase() === 'INTERN') return
    let cancelled = false
    setLoading(true)
    setError('')
    rpc('get_ai_insights_rpc', { p_token: token, p_limit: 50, p_include_acknowledged: false })
      .then(data => {
        if (cancelled) return
        setInsights(arrayFromRpc(data, ['insights', 'data']))
      })
      .catch(ex => { if (!cancelled) setError(ex.message || 'Unable to load insights') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, role])

  return { insights, loading, error }
}

function severityVariant(severity) {
  const s = Number(severity || 0)
  if (s >= 5) return 'danger'
  if (s >= 4) return 'overdue'
  if (s >= 3) return 'submitted'
  return 'default'
}

function severityLabel(severity) {
  const s = Number(severity || 0)
  if (s >= 5) return 'Critical'
  if (s >= 4) return 'High'
  if (s >= 3) return 'Medium'
  return 'Low'
}

function insightTypeLabel(t) {
  const labels = {
    task_risk: 'Task Risk',
    deadline_miss: 'Deadline Miss',
    inactivity: 'Inactivity',
    productivity_trend: 'Productivity',
    burnout_risk: 'Burnout Risk',
    proof_quality: 'Proof Quality',
    department_performance: 'Department'
  }
  return labels[t] || String(t || '').replace(/_/g, ' ')
}

function computeDeptStats(dept, users, overdueList, needsReviewList, blockedList) {
  const deptUsers = users.filter(u => userDepartment(u) === dept && String(u.role || '').toUpperCase() === 'INTERN')
  const userIds = new Set(deptUsers.map(u => u.id))
  const overdue = overdueList.filter(t => userIds.has(t.assigned_to_id))
  const needsReview = needsReviewList.filter(t => userIds.has(t.assigned_to_id))
  const blocked = blockedList.filter(t => userIds.has(t.assigned_to_id))
  return {
    members: deptUsers,
    memberCount: deptUsers.length,
    overdue,
    needsReview,
    blocked,
    totalStrikes: deptUsers.reduce((s, u) => s + Number(u.strikes || 0), 0)
  }
}

// Phase 7: memoized — only re-renders when activity/loading/title actually change.
const ActivityPanel = memo(function ActivityPanel({ activity, error, loading, hasMore, onLoadMore, onRetry, title = 'Company Activity' }) {
  return (
    <div className="panel">
      <SectionHead
        icon={<Activity size={16} />}
        title={title}
        action={error && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={onRetry}>Retry</button>
        )}
      />
      {error && <p className="form-error">{error}</p>}
      {activity.length ? (
        <div className="activity-feed">
          {activity.map(a => (
            <div key={a.id} className="activity-item">
              <div className="activity-dot" />
              <div className="activity-body">
                <p className="activity-text">
                  <b>{a.actor_name || 'System'}</b> {a.body}
                </p>
                {a.event_type && <span className="activity-type">{String(a.event_type).replace(/_/g, ' ')}</span>}
                {a.task_title && <span className="activity-task">→ {a.task_title}</span>}
                <span className="activity-time">{timeAgo(a.created_at)}</span>
              </div>
            </div>
          ))}
          {hasMore && (
            <button className="btn btn-ghost btn-sm activity-load-more" type="button" disabled={loading} onClick={onLoadMore}>
              {loading ? 'Loading...' : 'Load more'}
            </button>
          )}
        </div>
      ) : loading ? (
        <div className="attention-empty">Loading activity...</div>
      ) : (
        <Empty icon={<Activity size={20} />} text="No recent activity" />
      )}
    </div>
  )
})

const ProofFeedPanel = memo(function ProofFeedPanel({ proofFeed, limit = 5, title = 'Proof Feed' }) {
  return (
    <div className="panel">
      <SectionHead icon={<Camera size={16} />} title={title} />
      {proofFeed.length ? (
        proofFeed.slice(0, limit).map(p => (
          <div key={p.id} className="proof-item">
            <div className="proof-header">
              <b>{p.user}</b>
              <span className="muted small">{timeAgo(p.created_at)}</span>
            </div>
            <p className="proof-note">{p.note}</p>
            {p.screenshot_data_url && (
              <img className="proof-thumb" src={p.screenshot_data_url} alt="Proof preview" loading="lazy" />
            )}
            {p.is_submission && <Badge variant="badge-submitted">Submission</Badge>}
          </div>
        ))
      ) : (
        <Empty icon={<Camera size={20} />} text="No proofs yet" />
      )}
    </div>
  )
})

const AttentionColumn = memo(function AttentionColumn({ icon, title, items, emptyText, variant = 'overdue', renderMeta }) {
  return (
    <div className="attention-col">
      <div className={`attention-head attention-${variant}`}>
        {icon}
        <span>{title}</span>
        <b>{items.length}</b>
      </div>
      {items.length ? items.map(t => (
        <div key={t.id} className="attention-item">
          <div className="attention-task-title">{t.title}</div>
          <div className="attention-meta">
            {renderMeta ? renderMeta(t) : (
              <>
                <span>{t.assigned_to_name}</span>
                {t.due_date && <><span>·</span><span>{niceDate(t.due_date)}</span></>}
              </>
            )}
          </div>
        </div>
      )) : <div className="attention-empty">{emptyText}</div>}
    </div>
  )
})

// ── CEO VIEW ─────────────────────────────────────────────────────────────────

function CeoHomeView({ dash, token, me, reload, notify }) {
  const [applyingStrikes, setApplyingStrikes] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)
  const { items: feedItems, loading: feedLoading, error: feedError, hasMore: feedHasMore, offset: feedOffset, load: loadFeed } = useActivityFeed(token)
  const { insights, loading: insightsLoading } = useAiInsights(token, me?.role)

  const overdue = dash.attention_overdue || []
  const needsReview = dash.attention_needs_review || []
  const blocked = dash.attention_blocked || []
  const visibleUsers = dash.visible_users || []
  const founderRank = dash.founder_ranking || []
  const internRank = dash.intern_ranking || []
  const ideas = (dash.ideas || []).filter(i => i.status !== 'APPROVED' && i.status !== 'REJECTED')
  const proofFeed = dash.proof_feed || []
  const activity = feedItems.length ? feedItems : (dash.recent_activity || [])

  const topScore = [...founderRank, ...internRank].reduce((m, r) => Math.max(m, r.score || 0), 0)
  const totalStrikes = visibleUsers.reduce((s, u) => s + Number(u.strikes || 0), 0)

  const frontend = useMemo(() => computeDeptStats('frontend', visibleUsers, overdue, needsReview, blocked), [visibleUsers, overdue, needsReview, blocked])
  const backend = useMemo(() => computeDeptStats('backend', visibleUsers, overdue, needsReview, blocked), [visibleUsers, overdue, needsReview, blocked])

  const criticalInsights = useMemo(
    () => insights.filter(i => Number(i.severity) >= 4).slice(0, 5),
    [insights]
  )
  const inactiveMembers = useMemo(
    () => insights.filter(i => i.insight_type === 'inactivity').slice(0, 5),
    [insights]
  )
  const highRiskTasks = useMemo(
    () => insights.filter(i => i.insight_type === 'task_risk' && Number(i.severity) >= 4).slice(0, 5),
    [insights]
  )
  const bottlenecks = useMemo(() => {
    const seen = new Set()
    return [...blocked, ...overdue.filter(t => {
      if (!t.due_date) return false
      const d = new Date(t.due_date)
      if (Number.isNaN(d.getTime())) return false
      const days = Math.floor((Date.now() - d.getTime()) / 86400000)
      return days >= 7
    })].filter(t => {
      if (!t.id || seen.has(t.id)) return false
      seen.add(t.id)
      return true
    }).slice(0, 6)
  }, [blocked, overdue])

  // Overdue trend (last 7 days, derived from overdue list)
  const overdueTrend = useMemo(() => {
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      d.setHours(0, 0, 0, 0)
      return { dayKey: d.toISOString().slice(0, 10), label: d.toLocaleDateString(undefined, { weekday: 'short' }), count: 0 }
    })
    const byKey = Object.fromEntries(buckets.map(b => [b.dayKey, b]))
    overdue.forEach(t => {
      if (!t.due_date) return
      const k = String(t.due_date).slice(0, 10)
      if (byKey[k]) byKey[k].count += 1
    })
    return buckets
  }, [overdue])
  const trendMax = Math.max(1, ...overdueTrend.map(b => b.count))

  async function applyStrikesNow() {
    setApplyingStrikes(true)
    try {
      const r = await rpc('apply_strikes_rpc', { p_token: token })
      await reload()
      notify(r.applied ? `Applied ${r.applied} strike${r.applied === 1 ? '' : 's'}` : 'No overdue strikes to apply')
    } catch (ex) { notify(ex.message, 'error') }
    finally { setApplyingStrikes(false) }
  }

  async function generateWeekly() {
    setGeneratingReport(true)
    try {
      const r = await rpc('generate_ai_report_rpc', { p_token: token, p_template_key: 'weekly_company' })
      notify(`Weekly report generated · ${r.insight_count || 0} insight${r.insight_count === 1 ? '' : 's'}`)
    } catch (ex) { notify(ex.message || 'Could not generate report', 'error') }
    finally { setGeneratingReport(false) }
  }

  return (
    <div className="tab-home home-command-center role-ceo">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">Command Center</p>
          <h1 className="page-title">Good {getTimeGreeting()}, {me?.name?.split(' ')[0]}.</h1>
          <p className="page-subtitle">{me?.title} · {displayRole(me?.role)} · Company-wide view</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-ghost btn-sm" onClick={generateWeekly} disabled={generatingReport} type="button">
            <Activity size={15} />
            {generatingReport ? 'Generating...' : 'Generate Weekly Report'}
          </button>
          <button className="btn btn-strike" onClick={applyStrikesNow} disabled={applyingStrikes} type="button">
            <Flame size={16} />
            {applyingStrikes ? 'Applying...' : 'Apply Strikes'}
          </button>
        </div>
      </div>

      <div className="dashboard-section-label">Operational snapshot</div>
      <div className="stats-row">
        <StatCard icon={<AlertCircle size={18} />} label="Overdue" value={overdue.length} accent />
        <StatCard icon={<Zap size={18} />} label="Needs Review" value={needsReview.length} />
        <StatCard icon={<AlertCircle size={18} />} label="Blocked" value={blocked.length} />
        <StatCard icon={<Lightbulb size={18} />} label="Open Ideas" value={ideas.length} />
        <StatCard icon={<Trophy size={18} />} label="Top Score" value={topScore} />
        <StatCard icon={<Flame size={18} />} label="Total Strikes" value={totalStrikes} />
      </div>

      <div className="dashboard-section-label">Department health</div>
      <div className="dept-health-grid">
        {[['Frontend', frontend], ['Backend', backend]].map(([label, stats]) => (
          <div key={label} className="panel dept-health-card">
            <div className="dept-health-head">
              <div>
                <p className="eyebrow">{label}</p>
                <h3>{stats.memberCount} member{stats.memberCount === 1 ? '' : 's'}</h3>
              </div>
              {stats.totalStrikes > 0 && <Badge variant="strike">⚡ {stats.totalStrikes}</Badge>}
            </div>
            <div className="dept-health-stats">
              <div><b>{stats.overdue.length}</b><span>Overdue</span></div>
              <div><b>{stats.needsReview.length}</b><span>Review</span></div>
              <div><b>{stats.blocked.length}</b><span>Blocked</span></div>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-section-label">AI critical insights</div>
      <div className="panel ai-summary-panel">
        <SectionHead icon={<Zap size={16} />} title="Top advisory signals" />
        {insightsLoading ? (
          <div className="attention-empty">Loading insights...</div>
        ) : criticalInsights.length ? (
          <ul className="ai-insight-list">
            {criticalInsights.map(i => (
              <li key={i.id} className="ai-insight-row">
                <Badge variant={severityVariant(i.severity)}>{severityLabel(i.severity)}</Badge>
                <div className="ai-insight-body">
                  <b>{i.title}</b>
                  <span className="muted small">{insightTypeLabel(i.insight_type)}{i.target_department ? ` · ${i.target_department}` : ''}{i.target_user_name ? ` · ${i.target_user_name}` : ''}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<Zap size={20} />} text="No critical insights — generate a report from /reports." />
        )}
      </div>

      <div className="dashboard-section-label">Execution queues</div>
      <div className="attention-grid">
        <AttentionColumn icon={<AlertCircle size={15} />} variant="overdue" title="Overdue" items={overdue} emptyText="No overdue tasks" />
        <AttentionColumn icon={<Zap size={15} />} variant="review" title="Needs Review" items={needsReview} emptyText="No submissions pending review"
          renderMeta={t => (<><span>{t.assigned_to_name}</span><span>·</span><Badge variant="submitted">Submitted</Badge></>)} />
        <AttentionColumn icon={<AlertCircle size={15} />} variant="blocked" title="Blocked" items={blocked} emptyText="No blocked tasks"
          renderMeta={t => (<><span>{t.assigned_to_name}</span><Badge variant="priority-urgent">URGENT</Badge></>)} />
      </div>

      <div className="dashboard-section-label">Risk & rankings</div>
      <div className="ceo-grid-2col">
        <div className="panel">
          <SectionHead icon={<AlertCircle size={16} />} title="Bottlenecks" />
          {bottlenecks.length ? (
            <ul className="bottleneck-list">
              {bottlenecks.map(t => (
                <li key={t.id} className="bottleneck-row">
                  <div>
                    <b>{t.title}</b>
                    <span className="muted small">{t.assigned_to_name}{t.due_date ? ` · ${niceDate(t.due_date)}` : ''}</span>
                  </div>
                  <Badge variant={t.status === 'BLOCKED' ? 'blocked' : 'overdue'}>{t.status === 'BLOCKED' ? 'BLOCKED' : 'STALLED'}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty icon={<CheckCircle size={20} />} text="No active bottlenecks" />}
        </div>
        <div className="panel">
          <SectionHead icon={<AlertCircle size={16} />} title="High-risk tasks" />
          {highRiskTasks.length ? (
            <ul className="bottleneck-list">
              {highRiskTasks.map(i => (
                <li key={i.id} className="bottleneck-row">
                  <div>
                    <b>{i.title}</b>
                    <span className="muted small">{i.target_user_name || i.target_department || '—'}</span>
                  </div>
                  <Badge variant={severityVariant(i.severity)}>{severityLabel(i.severity)}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty icon={<CheckCircle size={20} />} text="No high-risk tasks flagged" />}
        </div>
      </div>

      <div className="ceo-grid-2col">
        <div className="panel ranking-panel">
          <SectionHead icon={<Trophy size={16} />} title="Top founders" />
          {founderRank.length ? founderRank.slice(0, 5).map(r => (
            <div key={r.id} className={`rank-row ${r.strikes >= 3 ? 'rank-danger' : ''}`}>
              <div className="rank-pos">#{r.rank}</div>
              <div className="rank-info">
                <b>{r.name}</b>
                <span className="muted small">{r.title} · {r.done}/{r.total} done · {r.overdue || 0} overdue</span>
              </div>
              <StrikeBadge count={r.strikes} />
              <div className="rank-score">{r.score}</div>
            </div>
          )) : <Empty icon={<Trophy size={20} />} text="No founder activity yet" />}
        </div>
        <div className="panel ranking-panel">
          <SectionHead icon={<Star size={16} />} title="Top interns" />
          {internRank.length ? internRank.slice(0, 5).map(r => (
            <div key={r.id} className={`rank-row ${r.strikes >= 3 ? 'rank-danger' : ''}`}>
              <div className="rank-pos">#{r.rank}</div>
              <div className="rank-info">
                <b>{r.name}</b>
                <span className="muted small">{r.title} · {r.done}/{r.total} done · {r.department || '—'}</span>
              </div>
              <StrikeBadge count={r.strikes} />
              <div className="rank-score">{r.score}</div>
            </div>
          )) : <Empty icon={<Star size={20} />} text="No intern activity yet" />}
        </div>
      </div>

      <div className="dashboard-section-label">Trends & operations</div>
      <div className="ceo-grid-2col">
        <div className="panel">
          <SectionHead icon={<Activity size={16} />} title="Overdue trend (7 days)" />
          <div className="trend-bars">
            {overdueTrend.map(b => (
              <div key={b.dayKey} className="trend-bar-col">
                <div className="trend-bar" style={{ height: `${Math.round((b.count / trendMax) * 60) + 4}px` }} title={`${b.count} overdue on ${b.label}`} />
                <span className="trend-label">{b.label}</span>
                <small>{b.count}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <SectionHead icon={<Users size={16} />} title="Inactive members" />
          {inactiveMembers.length ? (
            <ul className="bottleneck-list">
              {inactiveMembers.map(i => (
                <li key={i.id} className="bottleneck-row">
                  <div>
                    <b>{i.target_user_name || 'Unknown'}</b>
                    <span className="muted small">{i.description}</span>
                  </div>
                  <Badge variant={severityVariant(i.severity)}>{severityLabel(i.severity)}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty icon={<Users size={20} />} text="Everyone active" />}
        </div>
      </div>

      <div className="ceo-grid-2col">
        <div className="panel">
          <SectionHead icon={<Zap size={16} />} title="Review queue summary" />
          <p className="muted">{needsReview.length} submission{needsReview.length === 1 ? '' : 's'} awaiting review across the company.</p>
          <ul className="bottleneck-list">
            {needsReview.slice(0, 5).map(t => (
              <li key={t.id} className="bottleneck-row">
                <div>
                  <b>{t.title}</b>
                  <span className="muted small">{t.assigned_to_name}</span>
                </div>
                <Badge variant="submitted">Submitted</Badge>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel finance-placeholder">
          <SectionHead icon={<Activity size={16} />} title="Financial / project tracking" />
          <p className="muted">Reserved for a later phase. No financial or project schema exists yet — adding it here without backing tables would conflict with the master plan's "no random features" rule.</p>
        </div>
      </div>

      <div className="dashboard-section-label">Recent movement</div>
      <div className="home-bottom-grid">
        <ActivityPanel
          activity={activity}
          error={feedError}
          loading={feedLoading}
          hasMore={feedHasMore}
          onLoadMore={() => loadFeed({ off: feedOffset, append: true })}
          onRetry={() => loadFeed({ off: 0 })}
        />
        <ProofFeedPanel proofFeed={proofFeed} />
      </div>
    </div>
  )
}

// ── FOUNDER / DEPT-HEAD VIEW ─────────────────────────────────────────────────

function FounderHomeView({ dash, token, me, reload, notify }) {
  const myDept = userDepartment(me)
  const { items: feedItems, loading: feedLoading, error: feedError, hasMore: feedHasMore, offset: feedOffset, load: loadFeed } = useActivityFeed(token)
  const { insights, loading: insightsLoading } = useAiInsights(token, me?.role)

  const visibleUsers = dash.visible_users || []
  const allOverdue = dash.attention_overdue || []
  const allNeedsReview = dash.attention_needs_review || []
  const allBlocked = dash.attention_blocked || []
  const proofFeed = dash.proof_feed || []
  const internRank = dash.intern_ranking || []
  const activity = feedItems.length ? feedItems : (dash.recent_activity || [])

  const deptStats = useMemo(
    () => computeDeptStats(myDept, visibleUsers, allOverdue, allNeedsReview, allBlocked),
    [myDept, visibleUsers, allOverdue, allNeedsReview, allBlocked]
  )

  const deptInterns = deptStats.members
  const deptInternIds = new Set(deptInterns.map(u => u.id))
  const deptInternRank = internRank.filter(r => r.department === myDept || deptInternIds.has(r.id))
  const deptTopScore = deptInternRank.reduce((m, r) => Math.max(m, r.score || 0), 0)

  // Workload: tasks per intern
  const workload = useMemo(() => {
    return deptInterns.map(u => {
      const overdueCount = allOverdue.filter(t => t.assigned_to_id === u.id).length
      const reviewCount = allNeedsReview.filter(t => t.assigned_to_id === u.id).length
      const blockedCount = allBlocked.filter(t => t.assigned_to_id === u.id).length
      const total = overdueCount + reviewCount + blockedCount
      return { user: u, overdue: overdueCount, review: reviewCount, blocked: blockedCount, total }
    }).sort((a, b) => b.total - a.total)
  }, [deptInterns, allOverdue, allNeedsReview, allBlocked])
  const workloadMax = Math.max(1, ...workload.map(w => w.total))

  // Department-scoped proof feed
  const deptProofFeed = useMemo(
    () => proofFeed.filter(p => {
      // Match by user name → user object → department
      const u = visibleUsers.find(v => v?.name === p?.user || v?.username === p?.user)
      return u ? userDepartment(u) === myDept : false
    }),
    [proofFeed, visibleUsers, myDept]
  )

  return (
    <div className="tab-home home-command-center role-founder">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">{myDept ? `${myDept.charAt(0).toUpperCase()}${myDept.slice(1)} team` : 'Team workspace'}</p>
          <h1 className="page-title">Good {getTimeGreeting()}, {me?.name?.split(' ')[0]}.</h1>
          <p className="page-subtitle">{me?.title} · {displayRole(me?.role)}{myDept ? ` · ${myDept} department` : ''}</p>
        </div>
      </div>

      <div className="dashboard-section-label">Department snapshot</div>
      <div className="stats-row">
        <StatCard icon={<AlertCircle size={18} />} label="Dept Overdue" value={deptStats.overdue.length} accent />
        <StatCard icon={<Zap size={18} />} label="Dept Review" value={deptStats.needsReview.length} />
        <StatCard icon={<AlertCircle size={18} />} label="Dept Blocked" value={deptStats.blocked.length} />
        <StatCard icon={<Users size={18} />} label="Interns" value={deptInterns.length} />
        <StatCard icon={<Trophy size={18} />} label="Dept Top Score" value={deptTopScore} />
        <StatCard icon={<Flame size={18} />} label="Dept Strikes" value={deptStats.totalStrikes} />
      </div>

      <div className="dashboard-section-label">Intern management</div>
      <div className="panel">
        <SectionHead icon={<Users size={16} />} title="Your interns" />
        {deptInterns.length ? (
          <div className="founder-intern-list">
            {deptInterns.map(u => {
              const w = workload.find(x => x.user.id === u.id) || { overdue: 0, review: 0, blocked: 0 }
              const rank = deptInternRank.find(r => r.id === u.id)
              return (
                <div key={u.id} className={`founder-intern-row ${u.strikes >= 3 ? 'rank-danger' : ''}`}>
                  <div className="founder-intern-info">
                    <b>{u.name}</b>
                    <span className="muted small">{u.title}{rank ? ` · #${rank.rank} · ${rank.done}/${rank.total} done` : ''}</span>
                  </div>
                  <div className="founder-intern-counts">
                    {w.overdue > 0 && <Badge variant="overdue">{w.overdue} overdue</Badge>}
                    {w.review > 0 && <Badge variant="submitted">{w.review} review</Badge>}
                    {w.blocked > 0 && <Badge variant="blocked">{w.blocked} blocked</Badge>}
                    {(w.overdue + w.review + w.blocked) === 0 && <span className="muted small">Clear</span>}
                  </div>
                  <StrikeBadge count={u.strikes} />
                </div>
              )
            })}
          </div>
        ) : (
          <Empty icon={<Users size={20} />} text="No interns assigned to your department yet." />
        )}
      </div>

      <div className="dashboard-section-label">Execution queues</div>
      <div className="attention-grid">
        <AttentionColumn icon={<AlertCircle size={15} />} variant="overdue" title="Overdue" items={deptStats.overdue} emptyText="No overdue tasks in your department" />
        <AttentionColumn icon={<Zap size={15} />} variant="review" title="Needs Review" items={deptStats.needsReview} emptyText="No submissions pending review"
          renderMeta={t => (<><span>{t.assigned_to_name}</span><span>·</span><Badge variant="submitted">Submitted</Badge></>)} />
        <AttentionColumn icon={<AlertCircle size={15} />} variant="blocked" title="Blocked" items={deptStats.blocked} emptyText="No blocked tasks in your department"
          renderMeta={t => (<><span>{t.assigned_to_name}</span><Badge variant="priority-urgent">URGENT</Badge></>)} />
      </div>

      <div className="dashboard-section-label">Workload & performance</div>
      <div className="ceo-grid-2col">
        <div className="panel">
          <SectionHead icon={<Activity size={16} />} title="Workload by intern" />
          {workload.length ? (
            <div className="workload-list">
              {workload.map(w => (
                <div key={w.user.id} className="workload-row">
                  <span className="workload-name">{w.user.name}</span>
                  <div className="workload-bar-wrap">
                    <div className="workload-bar workload-overdue" style={{ width: `${(w.overdue / workloadMax) * 100}%` }} />
                    <div className="workload-bar workload-review" style={{ width: `${(w.review / workloadMax) * 100}%` }} />
                    <div className="workload-bar workload-blocked" style={{ width: `${(w.blocked / workloadMax) * 100}%` }} />
                  </div>
                  <span className="workload-total">{w.total}</span>
                </div>
              ))}
            </div>
          ) : <Empty icon={<Activity size={20} />} text="No active workload" />}
        </div>
        <div className="panel ranking-panel">
          <SectionHead icon={<Star size={16} />} title="Performance trends" />
          {deptInternRank.length ? deptInternRank.slice(0, 6).map(r => (
            <div key={r.id} className={`rank-row ${r.strikes >= 3 ? 'rank-danger' : ''}`}>
              <div className="rank-pos">#{r.rank}</div>
              <div className="rank-info">
                <b>{r.name}</b>
                <span className="muted small">{r.done}/{r.total} done · {r.submissions || 0} proofs · {r.overdue || 0} overdue</span>
              </div>
              <StrikeBadge count={r.strikes} />
              <div className="rank-score">{r.score}</div>
            </div>
          )) : <Empty icon={<Star size={20} />} text="No intern performance data yet" />}
        </div>
      </div>

      <div className="dashboard-section-label">Department signals</div>
      <div className="panel ai-summary-panel">
        <SectionHead icon={<Zap size={16} />} title="AI insights (your department)" />
        {insightsLoading ? (
          <div className="attention-empty">Loading insights...</div>
        ) : insights.length ? (
          <ul className="ai-insight-list">
            {insights.slice(0, 6).map(i => (
              <li key={i.id} className="ai-insight-row">
                <Badge variant={severityVariant(i.severity)}>{severityLabel(i.severity)}</Badge>
                <div className="ai-insight-body">
                  <b>{i.title}</b>
                  <span className="muted small">{insightTypeLabel(i.insight_type)}{i.target_user_name ? ` · ${i.target_user_name}` : ''}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<Zap size={20} />} text="No insights for your department right now." />
        )}
      </div>

      <div className="dashboard-section-label">Recent movement</div>
      <div className="home-bottom-grid">
        <ActivityPanel
          title="Department activity"
          activity={activity}
          error={feedError}
          loading={feedLoading}
          hasMore={feedHasMore}
          onLoadMore={() => loadFeed({ off: feedOffset, append: true })}
          onRetry={() => loadFeed({ off: 0 })}
        />
        <ProofFeedPanel proofFeed={deptProofFeed} title="Proof review shortcuts" />
      </div>
    </div>
  )
}

// ── INTERN VIEW ──────────────────────────────────────────────────────────────

function InternHomeView({ dash, token, me, reload, notify }) {
  const [focusMode, setFocusMode] = useState(false)

  const allOverdue = dash.attention_overdue || []
  const allNeedsReview = dash.attention_needs_review || []
  const allBlocked = dash.attention_blocked || []
  const proofFeed = dash.proof_feed || []
  const myId = me?.id

  // Strict client-side scoping to my own tasks (defense in depth — server already filters)
  const myOverdue = useMemo(() => allOverdue.filter(t => t.assigned_to_id === myId), [allOverdue, myId])
  const myNeedsReview = useMemo(() => allNeedsReview.filter(t => t.assigned_to_id === myId), [allNeedsReview, myId])
  const myBlocked = useMemo(() => allBlocked.filter(t => t.assigned_to_id === myId), [allBlocked, myId])
  const myProofs = useMemo(() => proofFeed.filter(p => p.user === me?.name || p.user === me?.username), [proofFeed, me])

  // "Today's tasks" = my non-DONE tasks due today or coming up soon
  // Pull from visible tasks set within dash if available; otherwise show queues
  const todayKey = new Date().toISOString().slice(0, 10)
  const allMyActive = useMemo(() => {
    const seen = new Set()
    return [...myOverdue, ...myNeedsReview, ...myBlocked].filter(t => {
      if (!t.id || seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
  }, [myOverdue, myNeedsReview, myBlocked])

  const todayTasks = useMemo(
    () => allMyActive.filter(t => !t.due_date || String(t.due_date).slice(0, 10) <= todayKey).slice(0, 8),
    [allMyActive, todayKey]
  )
  const upcoming = useMemo(() => {
    const sevenDays = new Date()
    sevenDays.setDate(sevenDays.getDate() + 7)
    const cutoff = sevenDays.toISOString().slice(0, 10)
    return allMyActive
      .filter(t => t.due_date && String(t.due_date).slice(0, 10) > todayKey && String(t.due_date).slice(0, 10) <= cutoff)
      .slice(0, 6)
  }, [allMyActive, todayKey])

  // "Changes requested" — tasks where status is CHANGES_REQUESTED or REJECTED for me
  const changesRequested = useMemo(
    () => allMyActive.filter(t => ['CHANGES_REQUESTED', 'REJECTED'].includes(String(t.status || '').toUpperCase())),
    [allMyActive]
  )

  // Personal progress (from intern_ranking, my row only)
  const myRank = useMemo(() => (dash.intern_ranking || []).find(r => r.id === myId), [dash.intern_ranking, myId])

  return (
    <div className={`tab-home home-command-center role-intern ${focusMode ? 'focus-mode-on' : ''}`}>
      <div className="page-header">
        <div>
          <p className="page-eyebrow">Today</p>
          <h1 className="page-title">Hi {me?.name?.split(' ')[0]}.</h1>
          <p className="page-subtitle">{me?.title} · {displayRole(me?.role)}</p>
        </div>
        <button className={`btn btn-ghost btn-sm focus-toggle ${focusMode ? 'is-on' : ''}`} type="button" onClick={() => setFocusMode(v => !v)}>
          <Zap size={15} />
          {focusMode ? 'Exit focus mode' : 'Focus mode'}
        </button>
      </div>

      <div className="dashboard-section-label">My snapshot</div>
      <div className="stats-row">
        <StatCard icon={<Clock size={18} />} label="Today" value={todayTasks.length} />
        <StatCard icon={<AlertCircle size={18} />} label="Overdue" value={myOverdue.length} accent />
        <StatCard icon={<Zap size={18} />} label="In Review" value={myNeedsReview.length} />
        <StatCard icon={<MessageSquare size={18} />} label="Changes" value={changesRequested.length} />
        {myRank && (
          <>
            <StatCard icon={<CheckCircle size={18} />} label="My Score" value={myRank.score || 0} />
            <StatCard icon={<Star size={18} />} label="My Rank" value={`#${myRank.rank || '—'}`} />
          </>
        )}
      </div>

      <div className="dashboard-section-label">Today’s tasks</div>
      <div className="panel intern-today-panel">
        {todayTasks.length ? (
          <ul className="intern-task-list">
            {todayTasks.map(t => (
              <li key={t.id} className="intern-task-row">
                <div>
                  <b>{t.title}</b>
                  <span className="muted small intern-task-meta">
                    <Badge variant={displayStatusBadge(t.status)}>{t.status}</Badge>
                    {t.due_date && <span>· due {niceDate(t.due_date)}</span>}
                  </span>
                </div>
                {t.priority && <Badge variant={`priority-${String(t.priority).toLowerCase()}`}>{t.priority}</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<CheckCircle size={20} />} text="You're clear for today. Pick up the next deadline below." />
        )}
      </div>

      {!focusMode && (
        <>
          <div className="dashboard-section-label">Coming up (7 days)</div>
          <div className="panel">
            {upcoming.length ? (
              <ul className="intern-task-list">
                {upcoming.map(t => (
                  <li key={t.id} className="intern-task-row">
                    <div>
                      <b>{t.title}</b>
                      <span className="muted small">due {niceDate(t.due_date)}</span>
                    </div>
                    {t.priority && <Badge variant={`priority-${String(t.priority).toLowerCase()}`}>{t.priority}</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={<CalendarDays size={20} />} text="Nothing due in the next 7 days." />
            )}
          </div>

          <div className="dashboard-section-label">Reviews & changes</div>
          <div className="ceo-grid-2col">
            <div className="panel">
              <SectionHead icon={<Zap size={16} />} title="Pending reviews" />
              {myNeedsReview.length ? myNeedsReview.map(t => (
                <div key={t.id} className="intern-task-row">
                  <div>
                    <b>{t.title}</b>
                    <span className="muted small">Awaiting reviewer feedback</span>
                  </div>
                  <Badge variant="submitted">Submitted</Badge>
                </div>
              )) : <Empty icon={<Zap size={20} />} text="No submissions pending review." />}
            </div>
            <div className="panel">
              <SectionHead icon={<MessageSquare size={16} />} title="Changes requested" />
              {changesRequested.length ? changesRequested.map(t => (
                <div key={t.id} className="intern-task-row">
                  <div>
                    <b>{t.title}</b>
                    <span className="muted small">Open the task to view reviewer notes.</span>
                  </div>
                  <Badge variant="rejected">{t.status}</Badge>
                </div>
              )) : <Empty icon={<CheckCircle size={20} />} text="No changes requested right now." />}
            </div>
          </div>

          <div className="dashboard-section-label">My recent proofs</div>
          <ProofFeedPanel proofFeed={myProofs} limit={4} title="Proof submissions" />
        </>
      )}
    </div>
  )
}

// ─── TASKS TAB ───────────────────────────────────────────────────────────────

const LAST_LOGIN_KEY = 'omnimate_last_login'
const taskViews = [
  { id: 'today', label: "Today's Tasks", icon: Clock, emptyTitle: 'No tasks for today', emptyText: 'Active work due today or coming up will appear here.' },
  { id: 'overdue', label: 'Overdue Tasks', icon: AlertCircle, emptyTitle: 'No overdue tasks', emptyText: 'Nothing is currently past due.' },
  { id: 'review', label: 'Tasks Under Review', icon: Zap, emptyTitle: 'No tasks under review', emptyText: 'Submitted tasks and proof review items will appear here.' },
  { id: 'history', label: 'Task History', icon: CheckCircle, emptyTitle: 'No completed history', emptyText: 'Completed tasks will collect here.' }
]

function TasksTab({ dash, token, me, reload, notify }) {
  const [tasks, setTasks] = useState([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [taskError, setTaskError] = useState('')
  const [activeView, setActiveView] = useState('today')
  const [taskCounts, setTaskCounts] = useState({ today: 0, overdue: 0, review: 0, history: 0 })
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [userFilter, setUserFilter] = useState('ALL')
  const [dateFilter, setDateFilter] = useState('')
  const [showAssign, setShowAssign] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [deletingId, setDeletingId] = useState('')
  const [taskDetail, setTaskDetail] = useState(null)
  const [historyOffset, setHistoryOffset] = useState(0)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [templates, setTemplates] = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [assigningTemplate, setAssigningTemplate] = useState(null)

  const safeDash = dash || emptyDash
  const safeMe = me || {}
  const visibleUsers = Array.isArray(safeDash.visible_users) ? safeDash.visible_users : []
  const safeTasks = Array.isArray(tasks) ? tasks : []
  const userById = useMemo(() => Object.fromEntries(visibleUsers.filter(Boolean).map(u => [u.id, u])), [visibleUsers])
  const canCreateTasks = safeMe.role !== 'INTERN'
  const role = String(safeMe.role || '').toUpperCase()
  const isIntern = role === 'INTERN'
  const isFounder = role === 'FOUNDER' || role === 'BOARD'
  const isCEO = role === 'CEO'
  const selectedView = taskViews.find(v => v.id === activeView) || taskViews[0]
  const selectedViewCount = Number(taskCounts[activeView] || 0)
  const assignableUsers = useMemo(() => {
    return visibleUsers
      .filter(u => canAssignToUser(safeMe, u))
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')) || String(a.name || '').localeCompare(String(b.name || '')))
  }, [visibleUsers, safeMe])

  // Track last login time for "new task" detection
  const lastLogin = useMemo(() => {
    const stored = localStorage.getItem(LAST_LOGIN_KEY)
    if (!stored) {
      localStorage.setItem(LAST_LOGIN_KEY, new Date().toISOString())
      return new Date().toISOString()
    }
    return stored
  }, [token])

  const loadTasks = useCallback(async ({ append = false, offset = 0 } = {}) => {
    setTasksLoading(true)
    setTaskError('')
    const limit = activeView === 'history' ? 25 : 80
    try {
      const data = await rpc('get_tasks_by_view_rpc', {
        p_token: token,
        p_view: activeView,
        p_limit: limit,
        p_offset: offset
      })
      const next = arrayFromRpc(data, ['tasks', 'task_list', 'items']).map(normalizeTaskForUi)
      setTaskCounts(data.counts || { today: 0, overdue: 0, review: 0, history: 0 })
      setHasMoreHistory(activeView === 'history' && next.length === limit)
      setHistoryOffset(offset + next.length)
      setTasks(current => append ? [...current, ...next] : next)
    } catch (ex) {
      console.error('get_tasks_by_view_rpc failed:', ex)
      setTaskError(ex?.message || 'Unable to load tasks. Please refresh or contact admin.')
      if (!append) setTasks([])
    } finally {
      setTasksLoading(false)
    }
  }, [token, activeView])

  const loadTemplates = useCallback(async () => {
    if (!token) return
    // Phase 7: skip template fetch for interns — they cannot create tasks
    // (canCreateTasks = role !== 'INTERN') so templates UI is hidden anyway.
    // Saves an RPC roundtrip + payload on every TasksTab mount for interns.
    if (String(safeMe?.role || '').toUpperCase() === 'INTERN') {
      setTemplates([])
      setTemplatesLoading(false)
      return
    }
    setTemplatesLoading(true)
    try {
      const data = await rpc('get_task_templates_rpc', { p_token: token, p_include_archived: false, p_limit: 80 })
      setTemplates(arrayFromRpc(data, ['templates', 'items', 'data']))
    } catch (ex) {
      console.warn('get_task_templates_rpc failed:', ex)
      setTemplates([])
    } finally {
      setTemplatesLoading(false)
    }
  }, [token, safeMe?.role])

  useEffect(() => {
    setTasks([])
    setHistoryOffset(0)
    setTaskDetail(null)
    setSelectedTask(null)
    loadTasks({ offset: 0 })
  }, [loadTasks])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const visibleRoleTasks = safeTasks.filter(t => {
    if (isIntern) return t.assigned_to_id === safeMe.id
    if (isFounder) {
      const assignee = userById[t.assigned_to_id] || { role: t.assignee_role, title: t.assignee_title, username: t.assignee_username }
      return t.assigned_to_id === safeMe.id || canManageInternForUser(safeMe, assignee)
    }
    return true
  })

  const taskFilterUsers = visibleUsers.filter(u => visibleRoleTasks.some(t => t.assigned_to_id === u.id))

  // Apply search + filters after role visibility has been enforced on the client.
  const searchFiltered = visibleRoleTasks.filter(t => {
    if (q && !`${t?.title || ''} ${t?.details || ''}`.toLowerCase().includes(q.toLowerCase())) return false
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false
    if (userFilter !== 'ALL' && t.assigned_to_id !== userFilter) return false
    if (dateFilter && t.due_date !== dateFilter) return false
    return true
  })

  // Sort: new → overdue → due soon → rest (incomplete first)
  const sorted = useMemo(() => {
    const lastLoginDate = new Date(lastLogin)

    return [...searchFiltered].sort((a, b) => {
      // New tasks first (assigned since last login)
      const aNew = a.created_at && new Date(a.created_at) > lastLoginDate
      const bNew = b.created_at && new Date(b.created_at) > lastLoginDate
      if (aNew && !bNew) return -1
      if (!aNew && bNew) return 1

      // Overdue before non-overdue
      const aOd = isOverdue(a)
      const bOd = isOverdue(b)
      if (aOd && !bOd) return -1
      if (!aOd && bOd) return 1

      // Due soon before not due soon (within 2 days)
      const aSoon = isDueSoon(a)
      const bSoon = isDueSoon(b)
      if (aSoon && !bSoon) return -1
      if (!aSoon && bSoon) return 1

      // Incomplete before done
      if (a.status === 'DONE' && b.status !== 'DONE') return 1
      if (a.status !== 'DONE' && b.status === 'DONE') return -1

      // By due date ascending
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return new Date(a.due_date) - new Date(b.due_date)
    })
  }, [searchFiltered, lastLogin])

  async function openTask(task) {
    if (!task?.id) return
    setSelectedTask(task)
    setTaskDetail(null)
    try {
      const detail = await rpc('get_task_by_id_rpc', { p_token: token, p_task_id: task.id })
      setTaskDetail(normalizeTaskForUi(objectFromRpc(detail)))
    } catch { setTaskDetail(null) }
  }

  async function setStatus(taskId, status) {
    try {
      await rpc('update_task_status_rpc', { p_token: token, p_task_id: taskId, p_status: status })
      await loadTasks({ offset: 0 })
      if (selectedTask?.id === taskId) {
        const detail = await rpc('get_task_by_id_rpc', { p_token: token, p_task_id: taskId }).catch(() => null)
        if (detail) setTaskDetail(normalizeTaskForUi(objectFromRpc(detail)))
      }
      notify('Status updated')
    } catch (ex) { notify(ex.message, 'error') }
  }

  async function deleteTask(task) {
    if (!task?.id) return
    if (!window.confirm(`Delete "${task.title || 'this task'}"?`)) return
    setDeletingId(task.id)
    try {
      await rpc('delete_task_rpc', { p_token: token, p_task_id: task.id })
      setTasks(prev => prev.filter(t => t.id !== task.id))
      if (selectedTask?.id === task.id) setSelectedTask(null)
      notify('Task deleted')
    } catch (ex) { notify(ex.message, 'error') }
    finally { setDeletingId('') }
  }

  async function createTemplateFromTask(task) {
    if (!task?.id) return
    try {
      await rpc('create_template_from_task_rpc', { p_token: token, p_task_id: task.id, p_visibility: 'private' })
      await loadTemplates()
      notify('Template saved')
    } catch (ex) { notify(ex.message, 'error') }
  }

  async function archiveTemplate(template) {
    if (!template?.id) return
    if (!window.confirm(`Archive "${template.title || 'this template'}"?`)) return
    try {
      await rpc('archive_task_template_rpc', { p_token: token, p_template_id: template.id, p_archived: true })
      await loadTemplates()
      notify('Template archived')
    } catch (ex) { notify(ex.message, 'error') }
  }

  function canManage(task) {
    return safeMe.role === 'CEO'
      || canManageInternForUser(safeMe, userById[task?.assigned_to_id] || { role: task?.assignee_role, title: task?.assignee_title, username: task?.assignee_username })
  }

  return (
    <div className="tab-tasks">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">Task execution</p>
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">
            {selectedView.label} · {selectedViewCount} total
          </p>
        </div>
        {canCreateTasks && (
          <div className="header-actions">
            <button className="btn" onClick={() => { setEditingTemplate(null); setShowTemplateModal(true) }}>
              <ClipboardList size={16} /> New Template
            </button>
            <button className="btn btn-primary" onClick={() => setShowAssign(true)}>
              <Plus size={16} /> New Task
            </button>
          </div>
        )}
      </div>

      <div className="templates-panel">
        <div className="templates-panel-head">
          <div>
            <span className="task-section-label"><ClipboardList size={13} /> Templates</span>
            <p className="muted small">Reusable task playbooks for repeated work and recurring assignments.</p>
          </div>
          {templatesLoading && <span className="muted small">Loading...</span>}
        </div>
        {templates.length ? (
          <div className="template-grid">
            {templates.slice(0, 8).map(template => (
              <div key={template.id} className="template-card">
                <div className="template-card-title">
                  <b>{template.title}</b>
                  <Badge variant={`badge-${priorityClass(template.default_priority)}`}>{template.default_priority}</Badge>
                </div>
                <p>{template.description || 'No description provided.'}</p>
                <div className="template-meta">
                  <span>{template.visibility}</span>
                  {template.default_department && <span>{template.default_department}</span>}
                  {Number(template.default_estimated_minutes || 0) > 0 && <span>{template.default_estimated_minutes}m</span>}
                </div>
                {canCreateTasks && (
                  <div className="template-actions">
                    <button className="btn btn-sm btn-primary" type="button" onClick={() => setAssigningTemplate(template)}>Use</button>
                    <button className="btn btn-sm" type="button" onClick={() => { setEditingTemplate(template); setShowTemplateModal(true) }}>Edit</button>
                    <button className="icon-btn icon-btn-sm" type="button" onClick={() => archiveTemplate(template)} aria-label="Archive template"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="attention-empty">{templatesLoading ? 'Loading templates...' : 'No templates yet'}</div>
        )}
      </div>

      {taskError && (
        <div className="notice notice-error task-retry-notice">
          <span>Unable to load tasks. Please refresh or contact admin.</span>
          <button className="btn btn-sm" type="button" onClick={() => loadTasks({ offset: 0 })}>Retry</button>
        </div>
      )}

      <div className="task-view-tabs" role="tablist" aria-label="Task columns">
        {taskViews.map(view => {
          const Icon = view.icon
          const count = Number(taskCounts[view.id] || 0)
          return (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={activeView === view.id}
              className={`task-view-tab ${activeView === view.id ? 'active' : ''}`}
              onClick={() => setActiveView(view.id)}
            >
              <Icon size={15} />
              <span>{view.label}</span>
              <b>{count}</b>
            </button>
          )
        })}
      </div>

      <div className="task-summary-strip">
        {taskViews.map(view => (
          <div key={view.id} className={`task-summary-item ${activeView === view.id ? 'active' : ''}`}>
            <span>{view.label}</span>
            <b>{Number(taskCounts[view.id] || 0)}</b>
          </div>
        ))}
      </div>

      <details className="task-filter-shell" open>
        <summary>
          <span><Search size={14} /> Filters</span>
          <ChevronDown size={15} />
        </summary>
        <div className="task-controls">
          <div className="task-search-wrap">
            <Search size={15} className="task-search-icon" />
            <input className="input task-search-input" placeholder={`Search ${selectedView.label.toLowerCase()}...`} value={q}
              onChange={e => setQ(e.target.value)} />
          </div>
          <select className="input task-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            {taskStatuses.map(status => (
              <option key={status} value={status}>{status === 'ALL' ? 'All statuses' : status.replace('_', ' ')}</option>
            ))}
          </select>
          {!isIntern && (
            <select className="input task-filter-select" value={userFilter} onChange={e => setUserFilter(e.target.value)}>
              <option value="ALL">All people</option>
              {taskFilterUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <input className="input task-filter-select" type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
        </div>
      </details>

      <div className={`task-lists ${selectedTask ? 'with-panel' : ''}`}>
        <div className="task-main-col">
          <div className="task-section task-column-section">
            <div className={`task-section-head task-column-head ${activeView === 'overdue' ? 'task-section-overdue' : activeView === 'review' ? 'task-section-new' : ''}`}>
              <span className="task-section-label">
                {React.createElement(selectedView.icon, { size: 13 })}
                {selectedView.label}
              </span>
              <span className="task-section-count">{sorted.length} shown</span>
            </div>
            {sorted.map(t => (
              <TaskRow key={t.id} task={t} userById={userById} me={safeMe} onOpen={() => openTask(t)}
                onSetStatus={setStatus} onDelete={() => deleteTask(t)} canManage={canManage(t)}
                isDeleting={deletingId === t.id} isSelected={selectedTask?.id === t.id}
                isOverdue={isOverdue(t)} isDueSoon={!isOverdue(t) && isDueSoon(t)}
                isManagedIntern={t.assignee_role === 'INTERN' && t.assigned_to_id !== safeMe.id}
                isDone={['DONE', 'APPROVED', 'REJECTED'].includes(t.status)} isNew={t.created_at && new Date(t.created_at) > new Date(lastLogin)}
                view={activeView} />
            ))}
            {activeView === 'history' && sorted.length > 0 && hasMoreHistory && (
              <button className="btn task-load-more" type="button" disabled={tasksLoading}
                onClick={() => loadTasks({ append: true, offset: historyOffset })}>
                {tasksLoading ? 'Loading...' : 'Load more history'}
              </button>
            )}
          </div>
          {sorted.length === 0 && !tasksLoading && (
            <div className="tasks-empty">
              <CheckCircle size={32} className="tasks-empty-icon" />
              <b>{selectedView.emptyTitle}</b>
              <p>{q || statusFilter !== 'ALL' || userFilter !== 'ALL' || dateFilter ? 'Try adjusting the filters for this column.' : selectedView.emptyText}</p>
            </div>
          )}
          {tasksLoading && <div className="loading" style={{ padding: '20px' }}>Loading tasks...</div>}
        </div>

        {/* Task Detail Panel */}
        {selectedTask && (
          <TaskDetailPanel
            task={selectedTask}
            detail={taskDetail}
            me={safeMe}
            token={token}
            onClose={() => { setSelectedTask(null); setTaskDetail(null) }}
            onStatusChange={(s) => setStatus(selectedTask.id, s)}
            onDelete={() => deleteTask(selectedTask)}
            onReload={async () => {
              const d = await rpc('get_task_by_id_rpc', { p_token: token, p_task_id: selectedTask.id }).catch(() => null)
              if (d) setTaskDetail(normalizeTaskForUi(objectFromRpc(d)))
            }}
            onProofSubmitted={reload}
            onCreateTemplate={canCreateTasks ? () => createTemplateFromTask(selectedTask) : null}
            notify={notify}
          />
        )}
      </div>

      {/* Assign Modal */}
      {showAssign && canCreateTasks && (
        <AssignModal
          token={token}
          users={visibleUsers}
          me={safeMe}
          onClose={() => setShowAssign(false)}
          onCreated={async (taskId) => {
            setShowAssign(false)
            await loadTasks({ offset: 0 })
            notify('Task created')
          }}
          notify={notify}
        />
      )}

      {showTemplateModal && canCreateTasks && (
        <TemplateModal
          token={token}
          me={safeMe}
          template={editingTemplate}
          onClose={() => { setShowTemplateModal(false); setEditingTemplate(null) }}
          onSaved={async () => {
            setShowTemplateModal(false)
            setEditingTemplate(null)
            await loadTemplates()
            notify(editingTemplate ? 'Template updated' : 'Template created')
          }}
          notify={notify}
        />
      )}

      {assigningTemplate && canCreateTasks && (
        <TemplateAssignModal
          token={token}
          template={assigningTemplate}
          users={assignableUsers}
          onClose={() => setAssigningTemplate(null)}
          onAssigned={async (createdCount) => {
            setAssigningTemplate(null)
            await loadTasks({ offset: 0 })
            notify(`Created ${createdCount || 0} task${createdCount === 1 ? '' : 's'} from template`)
          }}
          notify={notify}
        />
      )}
    </div>
  )
}

// ─── Task Row ────────────────────────────────────────────────────────────────

function TaskRow({ task, userById, onOpen, onSetStatus, onDelete, canManage, isDeleting, isSelected, isNew, isOverdue, isDueSoon, isManagedIntern, isDone, me, view }) {
  const safeTask = normalizeTaskForUi(task)
  const safeMe = me || {}
  const assignee = userById[safeTask.assigned_to_id] || { name: safeTask.assigned_to, strikes: 0 }
  const isForMe = safeTask.assigned_to_id === safeMe.id
  const canUpdateStatus = safeMe.role === 'CEO' || isForMe
  const statusLabel = String(safeTask.status || 'TODO').replace('_', ' ')
  const todayKey = new Date().toISOString().slice(0, 10)
  const lastProofDay = safeTask.last_proof_at ? new Date(safeTask.last_proof_at).toISOString().slice(0, 10) : ''
  const noUpdateToday = view === 'today' && !['DONE', 'APPROVED', 'REJECTED'].includes(safeTask.status) && lastProofDay !== todayKey
  const needsAttention = isOverdue || ['BLOCKED', 'SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED', 'CHANGES_REQUESTED'].includes(safeTask.status)

  return (
    <div
      className={[
        'task-row',
        isSelected ? 'task-row-selected' : '',
        isNew ? 'task-row-new' : '',
        isOverdue ? 'task-row-overdue' : '',
        isDueSoon ? 'task-row-soon' : '',
        isDone ? 'task-row-done' : '',
        isManagedIntern ? 'task-row-managed' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {/* Priority stripe */}
      <div className={`task-priority-stripe stripe-${priorityClass(safeTask.priority).toLowerCase()}`} />

      {/* Main content */}
      <div className="task-row-body">
        <div className="task-row-top">
          <span className="task-row-title">{safeTask.title}</span>
          {canManage && (
            <button className="task-row-delete" onClick={e => { e.stopPropagation(); onDelete() }}
              disabled={isDeleting} aria-label="Delete">
              <Trash2 size={13} />
            </button>
          )}
        </div>
        {safeTask.details && <p className="task-row-summary">{safeTask.details}</p>}

        <div className="task-row-meta">
          {/* Assignee */}
          <span className={`task-row-person ${isForMe ? 'is-me' : ''}`}>
            {isForMe ? 'Me' : (assignee.name || safeTask.assigned_to || 'Unassigned')}
            {safeTask.assigned_by_name && <span className="task-row-assigned-by"> from {safeTask.assigned_by_name}</span>}
          </span>

          {/* Badges row */}
          <div className="task-row-badges">
            <Badge variant={`badge-${displayStatusBadge(safeTask.status)}`}>{statusLabel}</Badge>
            <Badge variant={`badge-${priorityClass(safeTask.priority)}`}>{safeTask.priority}</Badge>
          </div>

          {/* Due date */}
          {safeTask.due_date && (
            <span className={`task-row-date ${isOverdue ? 'date-overdue' : isDueSoon ? 'date-soon' : ''}`}>
              <CalendarDays size={11} /> {niceDate(safeTask.due_date)}
            </span>
          )}

          {Number(safeTask.proof_count || safeTask.proofs?.length || 0) > 0 && (
            <span className="task-row-proof">
              <Camera size={11} /> {Number(safeTask.proof_count || safeTask.proofs?.length || 0)} proof{Number(safeTask.proof_count || safeTask.proofs?.length || 0) === 1 ? '' : 's'}
            </span>
          )}

          {/* State labels */}
          {needsAttention && <span className="task-row-attention-badge">Needs attention</span>}
          {safeTask.due_date === todayKey && <span className="task-row-due-badge">Due today</span>}
          {noUpdateToday && <span className="task-row-warning-badge">No update today</span>}
          {safeTask.last_proof_at && <span className="task-row-proof-line">Last proof {timeAgo(safeTask.last_proof_at)}</span>}
          {isNew && <span className="task-row-new-badge">New</span>}
          {isOverdue && <span className="task-row-overdue-badge">Overdue</span>}
          {Number(assignee.strikes) > 0 && <StrikeBadge count={assignee.strikes} />}
        </div>
      </div>

      {/* Status quick-change */}
      {canUpdateStatus && !isDone && (
        <select className="task-row-status"
          value={safeTask.status}
          onChange={e => { e.stopPropagation(); onSetStatus(safeTask.id, e.target.value) }}
          onClick={e => e.stopPropagation()}>
          {taskStatusOptionsFor(safeMe, safeTask).map(s => <option key={s}>{s}</option>)}
        </select>
      )}
    </div>
  )
}

function TaskDetailPanel({ task, detail, me, token, onClose, onStatusChange, onDelete, onReload, onProofSubmitted, onCreateTemplate, notify }) {
  const [localDetail, setLocalDetail] = useState(detail || null)
  const safeTask = normalizeTaskForUi(localDetail || detail || task)
  const safeMe = me || {}
  const panelRef = useRef(null)
  const previousFocusRef = useRef(null)
  const [comment, setComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [comments, setComments] = useState(Array.isArray(detail?.comments) ? detail.comments : [])
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [proofNote, setProofNote] = useState('')
  const [proofMinutes, setProofMinutes] = useState('')
  const [proofScreenshot, setProofScreenshot] = useState('')
  const [proofFileName, setProofFileName] = useState('')
  const [submittingProof, setSubmittingProof] = useState(false)
  const [proofs, setProofs] = useState(Array.isArray(detail?.proofs) ? detail.proofs : Array.isArray(task?.proofs) ? task.proofs : [])
  const [reviews, setReviews] = useState(Array.isArray(detail?.reviews) ? detail.reviews : [])
  const [reviewComment, setReviewComment] = useState('')
  const [reviewing, setReviewing] = useState('')
  const [proofError, setProofError] = useState('')
  const [previewProof, setPreviewProof] = useState(null)
  const [detailModerationReason, setDetailModerationReason] = useState('')
  const [moderatingAssignee, setModeratingAssignee] = useState(false)
  const canSubmitProof = safeMe.role === 'CEO' || safeTask.assigned_to_id === safeMe.id
  const canUpdateStatus = safeMe.role === 'CEO' || safeTask.assigned_to_id === safeMe.id
  const canReviewTask = safeMe.role === 'CEO'
    || safeTask.assigned_by_id === safeMe.id
    || canManageInternForUser(safeMe, { role: safeTask.assignee_role, title: safeTask.assignee_title, username: safeTask.assignee_username, id: safeTask.assigned_to_id })
  const isReviewable = ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'].includes(safeTask.status)

  useEffect(() => {
    const panel = panelRef.current
    previousFocusRef.current = document.activeElement
    const mobileQuery = window.matchMedia('(max-width: 768px)')
    const previousOverflow = document.body.style.overflow

    if (mobileQuery.matches) {
      document.body.style.overflow = 'hidden'
    }

    window.requestAnimationFrame(() => {
      const closeButton = panel?.querySelector('[data-task-detail-close]')
      ;(closeButton || panel)?.focus?.({ preventScroll: true })
    })

    return () => {
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus?.({ preventScroll: true })
    }
  }, [])

  function handlePanelKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }

    if (e.key !== 'Tab') return

    const focusable = panelRef.current?.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    )
    const nodes = Array.from(focusable || []).filter(node => node.getClientRects().length > 0)
    if (!nodes.length) return

    const first = nodes[0]
    const last = nodes[nodes.length - 1]

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // Load activity timeline
  useEffect(() => {
    if (!safeTask?.id) return
    setActivityLoading(true)
    rpc('get_activity_timeline_rpc', { p_token: token, p_task_id: safeTask.id, p_limit: 50 })
      .then(data => {
        const events = arrayFromRpc(data, ['data', 'items', 'activity'])
          .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
        setActivity(events)
      })
      .catch(() => setActivity([]))
      .finally(() => setActivityLoading(false))
  }, [safeTask?.id, token])

  useEffect(() => {
    if (detail) setLocalDetail(detail)
    if (Array.isArray(detail?.comments)) setComments(detail.comments)
    if (Array.isArray(detail?.proofs)) setProofs(detail.proofs)
    if (Array.isArray(detail?.reviews)) setReviews(detail.reviews)
  }, [detail])

  async function submitComment(e) {
    e.preventDefault()
    if (!comment.trim()) return
    setSubmittingComment(true)
    try {
      await rpc('add_task_comment_rpc', { p_token: token, p_task_id: safeTask.id, p_body: comment })
      const data = await rpc('get_task_comments_rpc', { p_token: token, p_task_id: safeTask.id })
      setComments(arrayFromRpc(data, ['data', 'comments', 'items']))
      setComment('')
      notify('Comment added')
    } catch (ex) { notify(ex.message, 'error') }
    finally { setSubmittingComment(false) }
  }

  async function reviewTask(action) {
    setReviewing(action)
    try {
      await rpc('review_task_rpc', {
        p_token: token,
        p_task_id: safeTask.id,
        p_action: action,
        p_comment: reviewComment
      })
      const nextDetail = await rpc('get_task_by_id_rpc', { p_token: token, p_task_id: safeTask.id }).catch(() => null)
      const normalizedDetail = nextDetail ? normalizeTaskForUi(objectFromRpc(nextDetail)) : null
      if (normalizedDetail) {
        setLocalDetail(normalizedDetail)
        setProofs(Array.isArray(normalizedDetail.proofs) ? normalizedDetail.proofs : [])
        setComments(Array.isArray(normalizedDetail.comments) ? normalizedDetail.comments : [])
        setReviews(Array.isArray(normalizedDetail.reviews) ? normalizedDetail.reviews : [])
      }
      setReviewComment('')
      await onReload?.()
      notify(action === 'APPROVE' ? 'Task approved' : action === 'REQUEST_CHANGES' ? 'Changes requested' : action === 'REJECT' ? 'Task rejected' : 'Review opened')
    } catch (ex) {
      notify(ex?.message || 'Unable to review task', 'error')
    } finally {
      setReviewing('')
    }
  }

  async function handleProofFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setProofError('')
    try {
      const dataUrl = await readFileAsDataURL(file)
      setProofScreenshot(dataUrl)
      setProofFileName(file.name)
    } catch {
      setProofError('Could not read the selected proof file.')
      setProofScreenshot('')
      setProofFileName('')
    }
  }

  async function submitProof(e) {
    e.preventDefault()
    const note = proofNote.trim()
    const minutes = Math.max(0, Number.parseInt(proofMinutes, 10) || 0)
    if (!note && !proofScreenshot) {
      setProofError('Add a note or upload a screenshot before submitting proof.')
      return
    }

    setSubmittingProof(true)
    setProofError('')
    try {
      await rpc('add_log_rpc', {
        p_token: token,
        p_task_id: safeTask.id,
        p_note: note,
        p_minutes: minutes,
        p_screenshot_data_url: proofScreenshot || null,
        p_is_submission: true
      })
      const nextDetail = await rpc('get_task_by_id_rpc', { p_token: token, p_task_id: safeTask.id }).catch(() => null)
      const normalizedDetail = nextDetail ? normalizeTaskForUi(objectFromRpc(nextDetail)) : null
      if (normalizedDetail) {
        setLocalDetail(normalizedDetail)
        setProofs(Array.isArray(normalizedDetail.proofs) ? normalizedDetail.proofs : [])
        if (Array.isArray(normalizedDetail.comments)) setComments(normalizedDetail.comments)
      }
      setProofNote('')
      setProofMinutes('')
      setProofScreenshot('')
      setProofFileName('')
      await onProofSubmitted?.()
      notify('Proof submitted')
    } catch (ex) {
      setProofError(ex?.message || 'Unable to submit proof.')
      notify(ex?.message || 'Unable to submit proof.', 'error')
    } finally {
      setSubmittingProof(false)
    }
  }

  async function adjustAssigneeStrike(delta) {
    const reason = detailModerationReason.trim()
    if (!safeTask.assigned_to_id || safeMe.role !== 'CEO') return
    if (!reason) {
      notify('Add a moderation reason first.', 'error')
      return
    }
    setModeratingAssignee(true)
    try {
      await rpc('moderate_strike_rpc', { p_token: token, p_target_user_id: safeTask.assigned_to_id, p_delta: delta, p_reason: reason })
      setDetailModerationReason('')
      await onProofSubmitted?.()
      notify(delta > 0 ? 'Strike added' : 'Strike removed')
    } catch (ex) {
      notify(ex?.message || 'Unable to update strikes.', 'error')
    } finally {
      setModeratingAssignee(false)
    }
  }

  const assignee = localDetail?.assigned_to_name || detail?.assigned_to_name || safeTask?.assigned_to || 'Unassigned'
  const assigner = localDetail?.assigned_by_name || detail?.assigned_by_name || safeTask?.assigned_by_name || 'Unknown'
  const statusLabel = String(safeTask.status || 'TODO').replace('_', ' ')
  const collaborators = useMemo(() => {
    const names = new Map()
    ;[
      [safeTask.assigned_to_id, assignee],
      [safeTask.assigned_by_id, assigner],
      ...comments.map(c => [c.user_id, c.user_name]),
      ...proofs.map(p => [p.user_id, p.user_name])
    ].forEach(([id, name]) => {
      const label = String(name || '').trim()
      if (label) names.set(id || label, label)
    })
    return Array.from(names.values()).slice(0, 8)
  }, [safeTask.assigned_to_id, safeTask.assigned_by_id, assignee, assigner, comments, proofs])

  return (
    <>
      <button className="task-detail-backdrop" type="button" aria-label="Close task details" onClick={onClose} />
      <aside
        className="task-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={handlePanelKeyDown}
      >
      <div className="detail-header">
        <div>
          <Badge variant={`badge-${displayStatusBadge(safeTask.status)}`}>{statusLabel}</Badge>
          <Badge variant={`badge-${priorityClass(safeTask.priority)}`}>{safeTask.priority}</Badge>
        </div>
        <button className="icon-btn icon-btn-sm" type="button" onClick={onClose} aria-label="Close task details" data-task-detail-close><X size={16} /></button>
      </div>

      <div className="detail-title" id="task-detail-title">{safeTask.title}</div>
      {safeTask.details && <p className="detail-desc muted">{safeTask.details}</p>}
      {onCreateTemplate && (
        <button className="btn btn-sm detail-template-action" type="button" onClick={onCreateTemplate}>
          <ClipboardList size={14} /> Save as Template
        </button>
      )}

      <div className="detail-meta-row">
        <div className="meta-item">
          <span className="meta-label">Assigned to</span>
          <span className="meta-val">{assignee}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Assigned by</span>
          <span className="meta-val">{assigner}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Due</span>
          <span className={`meta-val ${isOverdue(safeTask) ? 'text-overdue' : ''}`}>{niceDate(safeTask.due_date)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Time logged</span>
          <span className="meta-val">{safeTask.minutes || 0}m</span>
        </div>
      </div>

      {collaborators.length > 0 && (
        <div className="detail-section collaborators-section">
          <div className="detail-label"><Users size={14} /> Collaborators</div>
          <div className="collaborator-chips">
            {collaborators.map(name => <span key={name} className="collaborator-chip">{name}</span>)}
          </div>
        </div>
      )}

      {/* Status changer */}
      <div className="detail-section detail-status-section">
        <div className="detail-label"><CheckCircle size={14} /> Status</div>
        {canUpdateStatus ? (
          <select className="input status-select" value={safeTask.status}
            onChange={e => onStatusChange(e.target.value)}>
            {taskStatusOptionsFor(safeMe, safeTask).map(s => <option key={s}>{s}</option>)}
          </select>
        ) : (
          <div className="readonly-status">
            <Badge variant={`badge-${displayStatusBadge(safeTask.status)}`}>{statusLabel}</Badge>
          </div>
        )}
      </div>

      {canReviewTask && (isReviewable || reviews.length > 0) && (
        <div className="detail-section review-workspace-section">
          <div className="detail-label"><Zap size={14} /> Review Workspace</div>
          {isReviewable ? (
            <>
              <textarea className="input" placeholder="Reviewer comment, changes needed, or approval note..."
                value={reviewComment} onChange={e => setReviewComment(e.target.value)} />
              <div className="review-actions">
                {safeTask.status !== 'UNDER_REVIEW' && (
                  <button className="btn btn-sm" type="button" disabled={Boolean(reviewing)} onClick={() => reviewTask('OPEN_REVIEW')}>
                    {reviewing === 'OPEN_REVIEW' ? 'Opening...' : 'Open Review'}
                  </button>
                )}
                <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(reviewing)} onClick={() => reviewTask('APPROVE')}>
                  {reviewing === 'APPROVE' ? 'Approving...' : 'Approve'}
                </button>
                <button className="btn btn-sm" type="button" disabled={Boolean(reviewing)} onClick={() => reviewTask('REQUEST_CHANGES')}>
                  {reviewing === 'REQUEST_CHANGES' ? 'Saving...' : 'Request Changes'}
                </button>
                <button className="btn btn-danger btn-sm" type="button" disabled={Boolean(reviewing)} onClick={() => reviewTask('REJECT')}>
                  {reviewing === 'REJECT' ? 'Rejecting...' : 'Reject'}
                </button>
              </div>
            </>
          ) : (
            <p className="muted small">This task is not currently awaiting review.</p>
          )}
          {reviews.length > 0 && (
            <div className="review-history">
              {reviews.slice(0, 6).map(r => (
                <div key={r.id} className="review-entry">
                  <div className="review-entry-head">
                    <b>{String(r.action || '').replace('_', ' ')}</b>
                    <span className="muted small">{r.reviewer_name || 'Reviewer'} · {timeAgo(r.created_at)}</span>
                  </div>
                  {r.comment && <p>{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Proof submission */}
      <div className="detail-section detail-proof-submit-section">
        <div className="detail-label"><Upload size={14} /> Submit Proof</div>
        {canSubmitProof ? (
          <form className="proof-submit-form" onSubmit={submitProof}>
            <textarea className="input proof-note-input" placeholder="Describe what was completed, add links, blockers, or proof notes..."
              value={proofNote} onChange={e => setProofNote(e.target.value)} />
            <div className="proof-submit-grid">
              <div className="field proof-minutes-field">
                <label>Minutes</label>
                <input className="input" type="number" min="0" inputMode="numeric" placeholder="0"
                  value={proofMinutes} onChange={e => setProofMinutes(e.target.value)} />
              </div>
              <label className="btn proof-upload-btn">
                <Upload size={14} />
                <span>{proofFileName || 'Upload proof'}</span>
                <input type="file" accept="image/*" onChange={handleProofFile} />
              </label>
            </div>
            {proofScreenshot && (
              <div className="proof-preview">
                <img src={proofScreenshot} alt="Selected proof preview" />
                <button className="btn btn-sm" type="button" onClick={() => { setProofScreenshot(''); setProofFileName('') }}>Remove</button>
              </div>
            )}
            {proofError && <p className="form-error">{proofError}</p>}
            <button className="btn btn-primary btn-full" type="submit" disabled={submittingProof || (!proofNote.trim() && !proofScreenshot)}>
              {submittingProof ? 'Submitting proof...' : 'Submit Proof'}
            </button>
          </form>
        ) : (
          <p className="muted small">Proof submission is available to the assignee and CEO. Proof history remains visible below.</p>
        )}
      </div>

      {/* Comments */}
      <div className="detail-section">
        <div className="detail-label"><MessageSquare size={14} /> Comments ({comments.length})</div>
        <div className="comment-list">
          {comments.map(c => (
            <div key={c.id} className="comment-item">
              <div className="comment-head">
                <b>{c.user_name}</b>
                <span className="comment-role">{displayRole(c.user_role)}</span>
                <span className="comment-time muted">{timeAgo(c.created_at)}</span>
              </div>
              <p className="comment-body">{c.body}</p>
            </div>
          ))}
          {comments.length === 0 && <p className="muted small">No comments yet.</p>}
        </div>
        <form onSubmit={submitComment} className="comment-form">
          <input className="input" placeholder="Add a comment..." value={comment}
            onChange={e => setComment(e.target.value)} />
          <button className="btn btn-primary btn-sm" type="submit" disabled={submittingComment || !comment.trim()}>
            <Send size={13} />
          </button>
        </form>
      </div>

      {/* Proof History */}
      <div className="detail-section">
        <div className="detail-label"><Camera size={14} /> Proof History ({proofs.length})</div>
        {proofs.length
          ? proofs.map(p => (
            <div key={p.id} className="proof-entry">
              <div className="proof-head">
                <b>{p.user_name}</b>
                {p.is_submission && <Badge variant="badge-submitted">Submission</Badge>}
                <span className="muted small">{timeAgo(p.created_at)}</span>
              </div>
              {p.note && <p className="proof-note">{p.note}</p>}
              {p.screenshot_data_url && (
                <button className="proof-image-button" type="button" onClick={() => setPreviewProof(p)}>
                  <img className="proof-img" src={p.screenshot_data_url} alt="Proof screenshot" loading="lazy" />
                </button>
              )}
            </div>
          ))
          : <p className="muted small">No proofs submitted.</p>
        }
      </div>

      {/* Activity Timeline */}
      <div className="detail-section">
        <div className="detail-label"><Activity size={14} /> Timeline ({activity.length})</div>
        <div className="timeline">
          {activity.map(a => (
            <div key={a.id} className="timeline-item">
              <div className="timeline-dot" />
              <div>
                <p className="timeline-text"><b>{a.actor_name || 'System'}</b> {a.body}</p>
                <div className="timeline-meta">
                  {a.event_type && <span className="timeline-type">{String(a.event_type).replace(/_/g, ' ')}</span>}
                  <span className="timeline-time muted">{timeAgo(a.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
          {activityLoading && activity.length === 0 && <p className="muted small">Loading timeline...</p>}
          {!activityLoading && activity.length === 0 && <p className="muted small">No activity yet.</p>}
        </div>
      </div>

      {/* Danger Zone */}
      {safeMe.role === 'CEO' && (
        <div className="detail-danger">
          <div className="detail-section moderation-panel task-detail-moderation">
            <div className="detail-label"><Flame size={14} /> Assignee Moderation</div>
            <textarea className="input" placeholder={`Reason for adjusting ${assignee}'s strikes`}
              value={detailModerationReason} onChange={e => setDetailModerationReason(e.target.value)} />
            <div className="moderation-actions">
              <button className="btn btn-danger btn-sm" type="button" disabled={moderatingAssignee}
                onClick={() => adjustAssigneeStrike(1)}>
                <Flame size={14} /> Add Strike
              </button>
              <button className="btn btn-sm" type="button" disabled={moderatingAssignee}
                onClick={() => adjustAssigneeStrike(-1)}>
                Remove Strike
              </button>
            </div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={onDelete}>
            <Trash2 size={14} /> Delete this task
          </button>
        </div>
      )}
      </aside>
      {previewProof && (
        <div className="proof-viewer" role="dialog" aria-modal="true" aria-label="Proof preview" onClick={() => setPreviewProof(null)}>
          <div className="proof-viewer-card" onClick={e => e.stopPropagation()}>
            <div className="proof-viewer-head">
              <div>
                <b>{previewProof.user_name || 'Proof'}</b>
                <span className="muted small">{safeTask.title}</span>
                <span className="muted small">{timeAgo(previewProof.created_at)}</span>
              </div>
              <button className="icon-btn icon-btn-sm" type="button" onClick={() => setPreviewProof(null)} aria-label="Close proof preview"><X size={16} /></button>
            </div>
            {previewProof.note && <p className="proof-note">{previewProof.note}</p>}
            <img src={previewProof.screenshot_data_url} alt="Expanded proof screenshot" />
          </div>
        </div>
      )}
    </>
  )
}

// ─── Task Template Modals ───────────────────────────────────────────────────

function TemplateModal({ token, me, template, onClose, onSaved, notify }) {
  const isEditing = Boolean(template?.id)
  const managerDepartment = userDepartment(me)
  const [f, setF] = useState({
    title: template?.title || '',
    description: template?.description || '',
    default_priority: template?.default_priority || 'MEDIUM',
    default_department: template?.default_department || managerDepartment || '',
    default_estimated_minutes: template?.default_estimated_minutes || '',
    default_proof_requirement: template?.default_proof_requirement || '',
    default_checklist: Array.isArray(template?.default_checklist) ? template.default_checklist.join('\n') : '',
    visibility: template?.visibility || 'private'
  })
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!f.title.trim()) return
    setSaving(true)
    try {
      const checklist = f.default_checklist
        .split('\n')
        .map(item => item.trim())
        .filter(Boolean)
      await rpc('upsert_task_template_rpc', {
        p_token: token,
        p_template_id: template?.id || null,
        p_title: f.title,
        p_description: f.description,
        p_default_priority: f.default_priority,
        p_default_department: f.default_department,
        p_default_estimated_minutes: Number(f.default_estimated_minutes || 0),
        p_default_proof_requirement: f.default_proof_requirement,
        p_default_checklist: checklist,
        p_visibility: f.visibility
      })
      onSaved()
    } catch (ex) { notify(ex.message, 'error') }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEditing ? 'Edit Template' : 'New Template'}</h2>
          <button className="icon-btn icon-btn-sm" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <div className="field">
            <label>Template Title *</label>
            <input className="input" required placeholder="Reusable task title"
              value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea placeholder="Instructions, expected output, proof requirements..."
              value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
          </div>
          <div className="modal-row">
            <div className="field">
              <label>Default Priority</label>
              <select className="input" value={f.default_priority} onChange={e => setF({ ...f, default_priority: e.target.value })}>
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="URGENT">URGENT</option>
              </select>
            </div>
            <div className="field">
              <label>Estimated Time</label>
              <input className="input" type="number" min="0" placeholder="Minutes"
                value={f.default_estimated_minutes} onChange={e => setF({ ...f, default_estimated_minutes: e.target.value })} />
            </div>
          </div>
          <div className="modal-row">
            <div className="field">
              <label>Department</label>
              <select className="input" value={f.default_department} onChange={e => setF({ ...f, default_department: e.target.value })}>
                <option value="">None</option>
                {(me?.role === 'CEO' || managerDepartment === 'frontend') && <option value="frontend">Frontend</option>}
                {(me?.role === 'CEO' || managerDepartment === 'backend') && <option value="backend">Backend</option>}
              </select>
            </div>
            <div className="field">
              <label>Visibility</label>
              <select className="input" value={f.visibility} onChange={e => setF({ ...f, visibility: e.target.value })}>
                <option value="private">Private</option>
                <option value="department">Department</option>
                {me?.role === 'CEO' && <option value="company">Company</option>}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Proof Requirement</label>
            <input className="input" placeholder="Screenshot, notes, link, demo, etc."
              value={f.default_proof_requirement} onChange={e => setF({ ...f, default_proof_requirement: e.target.value })} />
          </div>
          <div className="field">
            <label>Checklist</label>
            <textarea placeholder="One checklist item per line"
              value={f.default_checklist} onChange={e => setF({ ...f, default_checklist: e.target.value })} />
          </div>
          <button className="btn btn-primary btn-full" type="submit" disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Save Template' : 'Create Template'}
          </button>
        </form>
      </div>
    </div>
  )
}

function TemplateAssignModal({ token, template, users, onClose, onAssigned, notify }) {
  const [f, setF] = useState({
    assigned_to: [],
    due_date: '',
    recurrence: 'ONE_TIME',
    recurrence_days: [],
    start_date: '',
    end_date: '',
    deadline_time: ''
  })
  const [saving, setSaving] = useState(false)
  const weekDays = [
    ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4],
    ['Fri', 5], ['Sat', 6], ['Sun', 7]
  ]

  function toggleUser(userId) {
    setF(current => {
      const assigned = current.assigned_to.includes(userId)
      return { ...current, assigned_to: assigned ? current.assigned_to.filter(id => id !== userId) : [...current.assigned_to, userId] }
    })
  }

  function toggleWeekDay(day) {
    setF(current => {
      const hasDay = current.recurrence_days.includes(day)
      return { ...current, recurrence_days: hasDay ? current.recurrence_days.filter(d => d !== day) : [...current.recurrence_days, day].sort() }
    })
  }

  async function submit(e) {
    e.preventDefault()
    if (!f.assigned_to.length) return
    setSaving(true)
    try {
      const data = await rpc('assign_task_template_rpc', {
        p_token: token,
        p_template_id: template.id,
        p_assigned_to: f.assigned_to,
        p_due_date: f.due_date || null,
        p_recurrence_type: f.recurrence,
        p_recurrence_days: f.recurrence === 'WEEKLY_DAYS' ? f.recurrence_days : [],
        p_start_date: f.start_date || f.due_date || new Date().toISOString().slice(0, 10),
        p_end_date: f.end_date || null,
        p_deadline_time: f.deadline_time || null
      })
      onAssigned(data.created_count || 0)
    } catch (ex) { notify(ex.message, 'error') }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Use Template</h2>
          <button className="icon-btn icon-btn-sm" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <div className="template-use-summary">
            <b>{template.title}</b>
            <span>{template.description || 'No description provided.'}</span>
          </div>
          <div className="field">
            <label>Assign to *</label>
            <div className="assignee-check-grid">
              {users.map(user => (
                <label key={user.id} className="weekday-check">
                  <input type="checkbox" checked={f.assigned_to.includes(user.id)} onChange={() => toggleUser(user.id)} />
                  <span>{user.name}</span>
                </label>
              ))}
            </div>
            {!users.length && <p className="muted small">No eligible assignees available for your department.</p>}
          </div>
          <div className="field">
            <label>Schedule</label>
            <select className="input" value={f.recurrence} onChange={e => setF({ ...f, recurrence: e.target.value })}>
              <option value="ONE_TIME">One-time task</option>
              <option value="DAILY">Daily until stopped</option>
              <option value="WEEKLY_DAYS">Weekly until stopped</option>
            </select>
          </div>
          {f.recurrence === 'ONE_TIME' ? (
            <div className="field">
              <label>Due date</label>
              <input className="input" type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} />
            </div>
          ) : (
            <>
              <div className="modal-row">
                <div className="field">
                  <label>Start date *</label>
                  <input className="input" type="date" required value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>Optional end date</label>
                  <input className="input" type="date" value={f.end_date} onChange={e => setF({ ...f, end_date: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Deadline time</label>
                <input className="input" type="time" value={f.deadline_time} onChange={e => setF({ ...f, deadline_time: e.target.value })} />
              </div>
            </>
          )}
          {f.recurrence === 'WEEKLY_DAYS' && (
            <div className="field">
              <label>Days</label>
              <div className="weekday-grid compact">
                {weekDays.map(([label, value]) => (
                  <label key={value} className="weekday-check">
                    <input type="checkbox" checked={f.recurrence_days.includes(value)} onChange={() => toggleWeekDay(value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <button className="btn btn-primary btn-full" type="submit" disabled={saving || !users.length}>
            {saving ? 'Assigning...' : 'Assign Template'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Assign Modal ─────────────────────────────────────────────────────────────

function AssignModal({ token, users, me, onClose, onCreated, notify }) {
  const assignableUsers = useMemo(() => {
    return users
      .filter(u => canAssignToUser(me, u))
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')) || String(a.name || '').localeCompare(String(b.name || '')))
  }, [users, me])

  const [f, setF] = useState({
    title: '', details: '', assigned_to: '', priority: 'HIGH', due_date: '',
    recurrence: 'ONE_TIME', recurrence_days: [], start_date: '', end_date: '', deadline_time: ''
  })
  const [saving, setSaving] = useState(false)
  const weekDays = [
    ['Monday', 1], ['Tuesday', 2], ['Wednesday', 3], ['Thursday', 4],
    ['Friday', 5], ['Saturday', 6], ['Sunday', 7]
  ]

  if (me?.role === 'INTERN') return null

  async function submit(e) {
    e.preventDefault()
    if (!f.assigned_to || !f.title.trim()) return
    setSaving(true)
    try {
      if (f.recurrence === 'ONE_TIME') {
        const result = await rpc('create_task_rpc', {
          p_token: token, p_title: f.title, p_details: f.details,
          p_assigned_to: f.assigned_to, p_priority: f.priority, p_due_date: f.due_date || null
        })
        onCreated(result.id)
      } else {
        const result = await rpc('create_recurring_task_rpc', {
          p_token: token,
          p_title: f.title,
          p_details: f.details,
          p_assigned_to: f.assigned_to,
          p_priority: f.priority,
          p_recurrence_type: f.recurrence === 'DAILY' ? 'DAILY' : 'WEEKLY_DAYS',
          p_recurrence_days: f.recurrence === 'WEEKLY_DAYS' ? f.recurrence_days : [],
          p_start_date: f.start_date || f.due_date || new Date().toISOString().slice(0, 10),
          p_end_date: f.end_date || null,
          p_deadline_time: f.deadline_time || null
        })
        notify(`Created ${result.created_count || 0} recurring task${result.created_count === 1 ? '' : 's'}`)
        onCreated(result.id)
      }
    } catch (ex) { notify(ex.message, 'error') }
    finally { setSaving(false) }
  }

  function toggleWeekDay(day) {
    setF(current => {
      const hasDay = current.recurrence_days.includes(day)
      return { ...current, recurrence_days: hasDay ? current.recurrence_days.filter(d => d !== day) : [...current.recurrence_days, day].sort() }
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Task</h2>
          <button className="icon-btn icon-btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <div className="field">
            <label>Task Title *</label>
            <input className="input" required placeholder="Clear, actionable task title"
              value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="field">
            <label>Details</label>
            <textarea placeholder="Context, expected output, proof requirements..."
              value={f.details} onChange={e => setF({ ...f, details: e.target.value })} />
          </div>
          <div className="field">
            <label>Assign to *</label>
            <select className="input" required value={f.assigned_to}
              onChange={e => setF({ ...f, assigned_to: e.target.value })}>
              <option value="">Select assignee...</option>
              {assignableUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name} — {u.title} ({displayRole(u.role)})</option>
              ))}
            </select>
            {assignableUsers.length === 0 && (
              <p className="muted small">No eligible assignees available for your department.</p>
            )}
          </div>
          <div className="modal-row">
            <div className="field">
              <label>Priority</label>
              <select className="input" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="URGENT">URGENT</option>
              </select>
            </div>
            <div className="field">
              <label>Deadline</label>
              <input className="input" type="date" value={f.due_date}
                onChange={e => setF({ ...f, due_date: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Recurrence</label>
            <select className="input" value={f.recurrence} onChange={e => setF({ ...f, recurrence: e.target.value })}>
              <option value="ONE_TIME">One-time task</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY_DAYS">Specific days of week</option>
            </select>
          </div>
          {f.recurrence !== 'ONE_TIME' && (
            <>
              <div className="modal-row">
                <div className="field">
                  <label>Start date *</label>
                  <input className="input" type="date" required value={f.start_date}
                    onChange={e => setF({ ...f, start_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>End date</label>
                  <input className="input" type="date" value={f.end_date}
                    onChange={e => setF({ ...f, end_date: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Deadline time</label>
                <input className="input" type="time" value={f.deadline_time}
                  onChange={e => setF({ ...f, deadline_time: e.target.value })} />
              </div>
            </>
          )}
          {f.recurrence === 'WEEKLY_DAYS' && (
            <div className="field">
              <label>Days</label>
              <div className="weekday-grid">
                {weekDays.map(([label, value]) => (
                  <label key={value} className="weekday-check">
                    <input type="checkbox" checked={f.recurrence_days.includes(value)} onChange={() => toggleWeekDay(value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <button className="btn btn-primary btn-full" type="submit" disabled={saving}>
            {saving ? 'Creating...' : f.recurrence === 'ONE_TIME' ? 'Create Task' : 'Create Recurring Tasks'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── IDEAS TAB ───────────────────────────────────────────────────────────────

function IdeasTab({ dash, token, me, reload, notify }) {
  const [form, setForm] = useState({ title: '', description: '' })
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [saving, setSaving] = useState(false)
  const [decisionNote, setDecisionNote] = useState({})

  const ideas = dash.ideas || []
  const filtered = statusFilter === 'ALL' ? ideas : ideas.filter(i => i.status === statusFilter)

  async function submitIdea(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await rpc('submit_idea_rpc', { p_token: token, p_title: form.title, p_description: form.description })
      setForm({ title: '', description: '' })
      await reload()
      notify('Idea submitted')
    } catch (ex) { notify(ex.message, 'error') }
    finally { setSaving(false) }
  }

  async function decide(i, nextStatus) {
    try {
      await rpc('update_idea_status_rpc', {
        p_token: token, p_idea_id: i.id, p_status: nextStatus,
        p_decision_note: decisionNote[i.id] || ''
      })
      setDecisionNote(d => ({ ...d, [i.id]: '' }))
      await reload()
      notify('Idea updated')
    } catch (ex) { notify(ex.message, 'error') }
  }

  async function deleteIdea(i) {
    if (!window.confirm(`Delete idea "${i.title}"?`)) return
    try {
      await rpc('delete_idea_rpc', { p_token: token, p_idea_id: i.id })
      await reload()
      notify('Idea deleted')
    } catch (ex) { notify(ex.message, 'error') }
  }

  function canDecide(i) {
    return me.role === 'CEO' || (me.role === 'BOARD' && i.submitted_by_role === 'INTERN')
  }
  function canDelete(i) {
    return me.role === 'CEO' || (i.submitted_by_id === me.id && i.status === 'PENDING')
  }

  return (
    <div className="tab-ideas">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">Ideas</p>
          <h1 className="page-title">Ideas</h1>
        </div>
      </div>

      {/* Submit Idea */}
      <div className="panel panel-submit">
        <h3 className="panel-submit-title"><Plus size={16} /> Submit an Idea</h3>
        <form onSubmit={submitIdea} className="idea-form">
          <div className="field">
            <label>Idea Title</label>
            <input className="input" required value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="New product, process, or growth idea" />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea required value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Describe the idea, expected impact, and next steps" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Submitting...' : 'Submit Idea'}
          </button>
        </form>
      </div>

      {/* Filter */}
      <div className="filter-bar">
        <div className="filter-pills">
          {['ALL', ...ideaStatuses].map(s => (
            <button key={s} className={`filter-pill ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}>
              {s === 'ALL' ? 'All' : s.replace('_', ' ')}
            </button>
          ))}
        </div>
        <span className="muted small">{filtered.length} idea{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Idea List */}
      {filtered.length
        ? filtered.map(i => (
          <div key={i.id} className="idea-card">
            <div className="idea-card-head">
              <div>
                <h3 className="idea-title">{i.title}</h3>
                <p className="idea-desc muted">{i.description}</p>
              </div>
              {canDelete(i) && (
                <button className="icon-btn icon-btn-sm danger-btn" onClick={() => deleteIdea(i)}
                  aria-label="Delete idea"><Trash2 size={13} /></button>
              )}
            </div>
            <div className="idea-card-meta">
              <Badge variant="badge-assignee">{i.submitted_by_name}</Badge>
              <span className="muted small">{displayRole(i.submitted_by_role)} · {timeAgo(i.created_at)}</span>
              <Badge variant={`badge-${i.status.toLowerCase().replace('_', '-')}`}>{i.status.replace('_', ' ')}</Badge>
            </div>
            {i.decision_note && (
              <div className="decision-note">
                <b>Decision:</b> {i.decision_note}
                {i.decision_by_name && <span className="muted"> — {i.decision_by_name}</span>}
              </div>
            )}
            {canDecide(i) && (
              <div className="decision-controls">
                <input className="input input-sm" placeholder="Decision note..."
                  value={decisionNote[i.id] || ''}
                  onChange={e => setDecisionNote(d => ({ ...d, [i.id]: e.target.value }))} />
                <div className="idea-action-btns">
                  {ideaStatuses.filter(s => s !== i.status).map(s => (
                    <button key={s} className="btn btn-sm" onClick={() => decide(i, s)}>
                      {s.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))
        : <Empty icon={<Lightbulb size={24} />} text="No ideas yet" />
      }
    </div>
  )
}

// ─── TEAM TAB ────────────────────────────────────────────────────────────────

function TeamTab({ dash, token, me, reload, notify }) {
  const [selectedUser, setSelectedUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [moderationReason, setModerationReason] = useState('')
  const [moderatingStrike, setModeratingStrike] = useState(false)
  const [rankings, setRankings] = useState(null)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [aiNotes, setAiNotes] = useState([])
  const [aiNoteLoading, setAiNoteLoading] = useState(false)
  const [aiNoteGenerating, setAiNoteGenerating] = useState(false)

  const people = dash.visible_users || []
  const founderRank = rankings?.founder_ranking || dash.founder_ranking || []
  const internRank = rankings?.intern_ranking || dash.intern_ranking || []
  const departmentRank = rankings?.department_rankings || []

  useEffect(() => {
    let cancelled = false
    setRankingLoading(true)
    rpc('get_rankings_rpc', { p_token: token })
      .then(data => { if (!cancelled) setRankings(data) })
      .catch(ex => notify(ex?.message || 'Unable to load rankings', 'error'))
      .finally(() => { if (!cancelled) setRankingLoading(false) })
    return () => { cancelled = true }
  }, [token])

  async function viewProfile(user) {
    setSelectedUser(user)
    setLoadingProfile(true)
    setAiNotes([])
    try {
      const p = await rpc('get_person_profile', { p_token: token, p_user_id: user.id })
      setProfile(p)
      await loadAiNotes(user.id)
    } catch (ex) { notify(ex.message, 'error'); setProfile(null) }
    finally { setLoadingProfile(false) }
  }

  async function loadAiNotes(userId) {
    if (!userId) return
    setAiNoteLoading(true)
    try {
      const data = await rpc('get_ai_work_notes_rpc', { p_token: token, p_user_id: userId })
      setAiNotes(Array.isArray(data.notes) ? data.notes : [])
    } catch {
      setAiNotes([])
    } finally {
      setAiNoteLoading(false)
    }
  }

  async function generateAiNote() {
    if (!selectedUser?.id) return
    setAiNoteGenerating(true)
    try {
      const context = {
        user: selectedUser,
        profile: {
          stats: profile?.user,
          recent_tasks: profile?.tasks || [],
          recent_proofs: profile?.recent_proofs || []
        }
      }
      const ai = await requestAiAnalysis(context).catch(() => ({ ok: false }))
      const data = await rpc('generate_ai_work_note_rpc', {
        p_token: token,
        p_user_id: selectedUser.id,
        p_period: 'recent',
        p_note: ai.ok ? ai.summary : null,
        p_raw_summary: { ai_enabled: Boolean(ai.ai_enabled), ai_error: ai.error || null }
      })
      setAiNotes(current => data.note ? [data.note, ...current] : current)
      notify(ai.ok ? 'AI work note generated' : 'Metrics note saved. AI is disabled or unavailable.')
    } catch (ex) {
      notify(ex?.message || 'Unable to generate note', 'error')
    } finally {
      setAiNoteGenerating(false)
    }
  }

  function canGenerateAiNoteFor(user) {
    if (!user?.id) return false
    if (me?.role === 'CEO') return true
    if (user.id === me?.id) return true
    return canManageInternForUser(me, user)
  }

  async function adjustStrike(delta) {
    if (!selectedUser?.id || me?.role !== 'CEO') return
    const reason = moderationReason.trim()
    if (!reason) {
      notify('Add a moderation reason first.', 'error')
      return
    }
    setModeratingStrike(true)
    try {
      await rpc('moderate_strike_rpc', { p_token: token, p_target_user_id: selectedUser.id, p_delta: delta, p_reason: reason })
      setModerationReason('')
      await reload()
      const p = await rpc('get_person_profile', { p_token: token, p_user_id: selectedUser.id })
      setProfile(p)
      setSelectedUser(current => current ? { ...current, strikes: Math.max(0, Number(current.strikes || 0) + delta) } : current)
      notify(delta > 0 ? 'Strike added' : 'Strike removed')
    } catch (ex) {
      notify(ex?.message || 'Unable to update strikes.', 'error')
    } finally {
      setModeratingStrike(false)
    }
  }

  return (
    <div className="tab-team">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">People & performance</p>
          <h1 className="page-title">Team</h1>
        </div>
      </div>

      {/* People Grid */}
      <div className="team-grid">
        <div className="team-section">
          <SectionHead icon={<Users size={16} />} title={`People (${people.length})`} />
          <div className="people-grid">
            {people.map(u => (
              <div key={u.id} className={`person-card ${u.strikes >= 3 ? 'person-danger' : ''}`}
                onClick={() => viewProfile(u)} role="button" tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    viewProfile(u)
                  }
                }}>
                <div className="person-avatar">{u.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
                <div className="person-info">
                  <b className="person-name">{u.name}</b>
                  <span className="person-title muted small">{u.title}</span>
                  <span className="person-role">{displayRole(u.role)}</span>
                </div>
                <StrikeBadge count={u.strikes} />
              </div>
            ))}
          </div>
        </div>

        {selectedUser && (
          <div className="team-section team-profile-panel">
            <div className="profile-header">
              <div>
                <h3>{selectedUser.name}</h3>
                <p className="muted">{selectedUser.title} · {displayRole(selectedUser.role)}</p>
              </div>
              <button className="icon-btn icon-btn-sm" onClick={() => { setSelectedUser(null); setProfile(null); setAiNotes([]) }}>
                <X size={16} />
              </button>
            </div>

            {loadingProfile ? (
              <div className="loading">Loading profile...</div>
            ) : profile?.user ? (
              <div className="profile-body">
                <div className="profile-stats">
                  <div className="profile-stat">
                    <b>{profile.user.score}</b>
                    <span>Score</span>
                  </div>
                  <div className="profile-stat">
                    <b>{profile.tasks?.length || 0}</b>
                    <span>Tasks</span>
                  </div>
                  <div className="profile-stat">
                    <b>{profile.ideas?.length || 0}</b>
                    <span>Ideas</span>
                  </div>
                  <div className="profile-stat">
                    <b>{profile.user.strikes}</b>
                    <span>Strikes</span>
                  </div>
                </div>

                {profile.tasks?.length > 0 && (
                  <div className="profile-section">
                    <h4>Recent Tasks</h4>
                    {profile.tasks.map(t => (
                      <div key={t.id} className="profile-task-item">
                        <span className="profile-task-title">{t.title}</span>
                        <Badge variant={`badge-${displayStatusBadge(t.status)}`}>{t.status.replace('_', ' ')}</Badge>
                        {t.assigned_by_name && <span className="muted small">by {t.assigned_by_name}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {profile.ideas?.length > 0 && (
                  <div className="profile-section">
                    <h4>Ideas</h4>
                    {profile.ideas.map(i => (
                      <div key={i.id} className="profile-task-item">
                        <span className="profile-task-title">{i.title}</span>
                        <Badge variant={`badge-${i.status.toLowerCase().replace('_', '-')}`}>{i.status.replace('_', ' ')}</Badge>
                      </div>
                    ))}
                  </div>
                )}

                {profile.recent_proofs?.length > 0 && (
                  <div className="profile-section">
                    <h4>Recent Proofs</h4>
                    {profile.recent_proofs.map(p => (
                      <div key={p.id} className="profile-task-item">
                        <span className="profile-task-title">{p.task_title}</span>
                        {p.is_submission && <Badge variant="badge-submitted">Submission</Badge>}
                        <span className="muted small">{timeAgo(p.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="profile-section ai-note-panel">
                  <div className="profile-section-head">
                    <h4>AI Work Note</h4>
                    {canGenerateAiNoteFor(selectedUser) && (
                      <button className="btn btn-sm" type="button" disabled={aiNoteGenerating} onClick={generateAiNote}>
                        <Zap size={13} /> {aiNoteGenerating ? 'Generating...' : 'Generate Note'}
                      </button>
                    )}
                  </div>
                  {aiNoteLoading ? (
                    <p className="muted small">Loading notes...</p>
                  ) : aiNotes.length > 0 ? (
                    <div className="ai-note-card">
                      <p>{aiNotes[0].note}</p>
                      <span className="muted small">{timeAgo(aiNotes[0].created_at)}</span>
                    </div>
                  ) : (
                    <p className="muted small">No AI work note generated yet.</p>
                  )}
                </div>

                {me?.role === 'CEO' && (
                  <div className="profile-section moderation-panel">
                    <h4>Moderation</h4>
                    <textarea className="input" placeholder="Reason for strike adjustment"
                      value={moderationReason} onChange={e => setModerationReason(e.target.value)} />
                    <div className="moderation-actions">
                      <button className="btn btn-danger btn-sm" type="button" disabled={moderatingStrike}
                        onClick={() => adjustStrike(1)}>
                        <Flame size={14} /> Add Strike
                      </button>
                      <button className="btn btn-sm" type="button" disabled={moderatingStrike}
                        onClick={() => adjustStrike(-1)}>
                        Remove Strike
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="muted">Profile not available.</p>
            )}
          </div>
        )}
      </div>

      {/* Rankings */}
      {rankingLoading && me.role !== 'INTERN' && <div className="loading">Updating rankings...</div>}

      {departmentRank.length > 0 && me.role !== 'INTERN' && (
        <div className="panel ranking-panel">
          <SectionHead icon={<Activity size={16} />} title="Department Rankings" />
          <div className="ranking-list">
            {departmentRank.map(r => (
              <div key={r.department} className="rank-row">
                <div className="rank-pos">{r.department === 'frontend' ? 'FE' : 'BE'}</div>
                <div className="rank-info">
                  <b>{r.department === 'frontend' ? 'Frontend Interns' : 'Backend Interns'}</b>
                  <span className="muted small">{r.completed} completed · {r.submissions} submissions · {r.overdue} overdue</span>
                </div>
                <StrikeBadge count={r.strikes} />
                <div className="rank-score">{r.score}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {founderRank.length > 0 && me.role !== 'INTERN' && (
        <div className="panel ranking-panel">
          <SectionHead icon={<Trophy size={16} />} title="Founding Member Rankings" />
          <div className="ranking-list">
            {founderRank.map(r => (
              <div key={r.id} className={`rank-row ${r.strikes >= 3 ? 'rank-danger' : ''}`}>
                <div className="rank-pos">#{r.rank}</div>
                <div className="rank-info">
                  <b>{r.name}</b>
                  <span className="muted small">
                    {r.title} · {r.done}/{r.total} done · {r.submissions || 0} proofs · {r.overdue || 0} overdue
                    {Number(r.avg_completion_hours) > 0 && ` · ${r.avg_completion_hours}h avg`}
                  </span>
                </div>
                <StrikeBadge count={r.strikes} />
                <div className="rank-score">{r.score}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {internRank.length > 0 && me.role !== 'INTERN' && (
        <div className="panel ranking-panel">
          <SectionHead icon={<Star size={16} />} title="Intern Rankings" />
          <div className="ranking-list">
            {internRank.map(r => (
              <div key={r.id} className={`rank-row ${r.strikes >= 3 ? 'rank-danger' : ''}`}>
                <div className="rank-pos">#{r.rank}</div>
                <div className="rank-info">
                  <b>{r.name}</b>
                  <span className="muted small">
                    {r.title} · {r.done}/{r.total} done · {r.submissions || 0} proofs · {r.overdue || 0} overdue
                    {r.department && ` · ${r.department}`}
                    {Number(r.consistency_days) > 0 && ` · ${r.consistency_days} active days`}
                  </span>
                </div>
                <StrikeBadge count={r.strikes} />
                <div className="rank-score">{r.score}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── MORE TAB ────────────────────────────────────────────────────────────────

function MoreTab({ dash, token, me, reload, notify }) {
  const [report, setReport] = useState(null)
  const [reportPeriod, setReportPeriod] = useState('weekly')
  const [reportLoading, setReportLoading] = useState(false)
  const [aiReport, setAiReport] = useState(null)
  const [aiReportLoading, setAiReportLoading] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notifLoading, setNotifLoading] = useState(false)
  const [showRead, setShowRead] = useState(false)

  async function loadReport(period) {
    setReportLoading(true)
    try {
      const r = await rpc('get_report_rpc', { p_token: token, p_period: period })
      setReport(r)
      setReportPeriod(period)
      notify(`${period[0].toUpperCase() + period.slice(1)} report loaded`)
    } catch (ex) { notify(ex.message, 'error') }
    finally { setReportLoading(false) }
  }

  async function generateAiReport(period) {
    setAiReportLoading(true)
    try {
      const context = {
        period,
        report,
        rankings: {
          founders: dash.founder_ranking || [],
          interns: dash.intern_ranking || []
        },
        queues: {
          overdue: dash.attention_overdue || [],
          needs_review: dash.attention_needs_review || [],
          blocked: dash.attention_blocked || []
        }
      }
      const ai = await requestAiAnalysis(context).catch(() => ({ ok: false }))
      const data = await rpc('generate_ai_report_rpc', {
        p_token: token,
        p_period: period,
        p_ai_summary: ai.ok ? ai.summary : null,
        p_report_json: { ai_enabled: Boolean(ai.ai_enabled), ai_error: ai.error || null }
      })
      setAiReport(data.report || null)
      setReportPeriod(period)
      notify(ai.ok ? 'AI report generated' : 'Metrics report saved. AI is disabled or unavailable.')
    } catch (ex) {
      notify(ex?.message || 'Unable to generate AI report', 'error')
    } finally {
      setAiReportLoading(false)
    }
  }

  async function loadNotifications() {
    setNotifLoading(true)
    try {
      const n = await rpc('get_notifications', { p_token: token, p_limit: 50, p_include_read: showRead })
      setNotifications(n.items || [])
    } catch { setNotifications([]) }
    finally { setNotifLoading(false) }
  }

  useEffect(() => { loadNotifications() }, [token, showRead])

  async function markRead(id) {
    try {
      await rpc('mark_notification_read_rpc', { p_token: token, p_notification_id: id })
      await loadNotifications()
      await reload()
    } catch {}
  }

  async function markAllRead() {
    try {
      await rpc('mark_all_notifications_read_rpc', { p_token: token })
      await loadNotifications()
      await reload()
    } catch {}
  }

  const unreadCount = notifications.filter(n => !n.read_at).length

  return (
    <div className="tab-more">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">Reports & system</p>
          <h1 className="page-title">More</h1>
        </div>
      </div>

      <div className="more-grid">
        {/* Reports */}
        {me.role === 'CEO' && (
          <div className="panel panel-reports">
            <SectionHead icon={<Download size={16} />} title="Reports" />
            <p className="muted small">CEO reports for weekly and monthly review.</p>
            <div className="report-actions">
              <button className="btn" onClick={() => loadReport('weekly')} disabled={reportLoading}>
                Weekly Report
              </button>
              <button className="btn" onClick={() => loadReport('monthly')} disabled={reportLoading}>
                Monthly Report
              </button>
              <button className="btn" onClick={() => generateAiReport('weekly')} disabled={aiReportLoading}>
                <Zap size={14} /> Weekly AI Report
              </button>
              <button className="btn" onClick={() => generateAiReport('monthly')} disabled={aiReportLoading}>
                <Zap size={14} /> Monthly AI Report
              </button>
            </div>
            {report && (
              <div className="report-content">
                <div className="report-best">
                  {report.best_founder && (
                    <div className="best-item">
                      <span className="best-label">Best Founding Member</span>
                      <span className="best-name">{report.best_founder.name}</span>
                      <span className="best-score">{report.best_founder.score} pts</span>
                    </div>
                  )}
                  {report.best_intern && (
                    <div className="best-item">
                      <span className="best-label">Best Intern</span>
                      <span className="best-name">{report.best_intern.name}</span>
                      <span className="best-score">{report.best_intern.score} pts</span>
                    </div>
                  )}
                </div>
                <button className="btn btn-primary" onClick={() => downloadJson(`omnimate-${reportPeriod}-report.json`, report)}>
                  <Download size={14} /> Download JSON
                </button>
              </div>
            )}
            {aiReport && (
              <div className="report-content ai-report-content">
                <b>{aiReport.period} AI Report</b>
                <p className="muted small">{aiReport.ai_summary}</p>
                <button className="btn btn-primary" onClick={() => downloadJson(`omnimate-${aiReport.period}-ai-report.json`, aiReport)}>
                  <Download size={14} /> Download AI JSON
                </button>
              </div>
            )}
          </div>
        )}

        {/* Notifications */}
        <div className="panel panel-notifications">
          <div className="notif-head">
            <SectionHead icon={<Bell size={16} />} title={`Notifications`} />
            <div className="notif-actions">
              <label className="notif-toggle">
                <input type="checkbox" checked={showRead} onChange={e => setShowRead(e.target.checked)} />
                <span>Show read</span>
              </label>
              {unreadCount > 0 && (
                <button className="btn btn-sm" onClick={markAllRead}>Mark all read</button>
              )}
            </div>
          </div>
          {notifLoading ? (
            <div className="loading">Loading...</div>
          ) : notifications.length > 0 ? (
            <div className="notif-list">
              {notifications.map(n => (
                <div key={n.id} className={`notif-item ${n.read_at ? 'notif-read' : 'notif-unread'}`}>
                  <div className="notif-body">
                    <b>{n.title}</b>
                    {n.body && <p className="notif-text muted small">{n.body}</p>}
                    <span className="notif-time muted">{timeAgo(n.created_at)}</span>
                  </div>
                  {!n.read_at && (
                    <button className="btn btn-sm" onClick={() => markRead(n.id)}>
                      <CheckCircle size={12} /> Read
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<Bell size={20} />} text="No notifications" />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTimeGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

// ─── Mount ────────────────────────────────────────────────────────────────────

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
)
