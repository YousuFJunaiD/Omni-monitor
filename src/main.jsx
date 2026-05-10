import React, {useEffect, useMemo, useRef, useState, useCallback} from 'react'
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

// ─── Utilities ───────────────────────────────────────────────────────────────

async function rpc(name, args) {
  if (!supabaseReady) throw new Error('Add Supabase keys in .env.local')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  if (data?.ok === false) throw new Error(data.error || 'Request failed')
  return data
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
  return task.due_date && task.status !== 'DONE' && new Date(`${task.due_date}T23:59:59`) < new Date()
}

function isDueSoon(task) {
  if (!task.due_date || task.status === 'DONE') return false
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
  const map = { TODO: 'todo', IN_PROGRESS: 'in_progress', SUBMITTED: 'submitted', DONE: 'done', BLOCKED: 'blocked' }
  return map[status] || 'todo'
}

function priorityClass(p) {
  return { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', URGENT: 'urgent' }[p] || 'medium'
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
  const [toast, setToast] = useState(null)

  async function load() {
    if (!token) return
    setLoading(true)
    setErr('')
    try {
      const data = await rpc('get_dashboard', { p_token: token })
      setDash(data)
    } catch (ex) {
      setErr(ex.message)
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(LEGACY_TOKEN_KEY)
      setToken('')
    } finally { setLoading(false) }
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

function StatCard({ icon, label, value, accent }) {
  return (
    <div className={`stat-card ${accent ? 'stat-accent' : ''}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <b className="stat-value">{value ?? 0}</b>
        <span className="stat-label">{label}</span>
      </div>
    </div>
  )
}

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

// ─── HOME TAB ────────────────────────────────────────────────────────────────

function HomeTab({ dash, token, me, reload, notify }) {
  const [applyingStrikes, setApplyingStrikes] = useState(false)

  async function applyStrikesNow() {
    setApplyingStrikes(true)
    try {
      const r = await rpc('apply_strikes_rpc', { p_token: token })
      await reload()
      notify(r.applied ? `Applied ${r.applied} strike${r.applied === 1 ? '' : 's'}` : 'No overdue strikes to apply')
    } catch (ex) { notify(ex.message, 'error') }
    finally { setApplyingStrikes(false) }
  }

  const overdue = dash.attention_overdue || []
  const needsReview = dash.attention_needs_review || []
  const blocked = dash.attention_blocked || []
  const activity = dash.recent_activity || []
  const ideas = (dash.ideas || []).filter(i => i.status !== 'APPROVED' && i.status !== 'REJECTED')
  const proofFeed = dash.proof_feed || []

  const topScore = [...(dash.founder_ranking || []), ...(dash.intern_ranking || [])]
    .reduce((m, r) => Math.max(m, r.score || 0), 0)

  return (
    <div className="tab-home home-command-center">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">Execution OS</p>
          <h1 className="page-title">Good {getTimeGreeting()}, {me?.name?.split(' ')[0]}.</h1>
          <p className="page-subtitle">{me?.title} · {displayRole(me?.role)}</p>
        </div>
        {me?.role === 'CEO' && (
          <button className="btn btn-strike" onClick={applyStrikesNow} disabled={applyingStrikes}>
            <Flame size={16} />
            {applyingStrikes ? 'Applying...' : 'Apply Strikes'}
          </button>
        )}
      </div>

      <div className="dashboard-section-label">Operational snapshot</div>
      <div className="stats-row">
        <StatCard icon={<AlertCircle size={18} />} label="Overdue" value={overdue.length} accent />
        <StatCard icon={<Zap size={18} />} label="Needs Review" value={needsReview.length} />
        <StatCard icon={<AlertCircle size={18} />} label="Blocked" value={blocked.length} />
        <StatCard icon={<Lightbulb size={18} />} label="Open Ideas" value={ideas.length} />
        <StatCard icon={<Trophy size={18} />} label="Top Score" value={topScore} />
        <StatCard icon={<Flame size={18} />} label="Total Strikes" value={
          (dash.visible_users || []).reduce((s, u) => s + (u.strikes || 0), 0)
        } />
      </div>

      <div className="dashboard-section-label">Execution queues</div>
      <div className="attention-grid">
        {/* Overdue */}
        <div className="attention-col">
          <div className="attention-head attention-overdue">
            <AlertCircle size={15} />
            <span>Overdue</span>
            <b>{overdue.length}</b>
          </div>
          {overdue.length
            ? overdue.map(t => (
              <div key={t.id} className="attention-item">
                <div className="attention-task-title">{t.title}</div>
                <div className="attention-meta">
                  <span>{t.assigned_to_name}</span>
                  <span>·</span>
                  <span className="text-overdue">{niceDate(t.due_date)}</span>
                </div>
              </div>
            ))
            : <div className="attention-empty">No overdue tasks</div>
          }
        </div>

        {/* Needs Review */}
        <div className="attention-col">
          <div className="attention-head attention-review">
            <Zap size={15} />
            <span>Needs Review</span>
            <b>{needsReview.length}</b>
          </div>
          {needsReview.length
            ? needsReview.map(t => (
              <div key={t.id} className="attention-item">
                <div className="attention-task-title">{t.title}</div>
                <div className="attention-meta">
                  <span>{t.assigned_to_name}</span>
                  <span>·</span>
                  <Badge variant="submitted">Submitted</Badge>
                </div>
              </div>
            ))
            : <div className="attention-empty">No submissions pending review</div>
          }
        </div>

        {/* Blocked */}
        <div className="attention-col">
          <div className="attention-head attention-blocked">
            <AlertCircle size={15} />
            <span>Blocked</span>
            <b>{blocked.length}</b>
          </div>
          {blocked.length
            ? blocked.map(t => (
              <div key={t.id} className="attention-item">
                <div className="attention-task-title">{t.title}</div>
                <div className="attention-meta">
                  <span>{t.assigned_to_name}</span>
                  <Badge variant="priority-urgent">URGENT</Badge>
                </div>
              </div>
            ))
            : <div className="attention-empty">No blocked tasks</div>
          }
        </div>
      </div>

      <div className="dashboard-section-label">Recent movement</div>
      <div className="home-bottom-grid">
        {/* Recent Activity */}
        <div className="panel">
          <SectionHead icon={<Activity size={16} />} title="Recent Activity" />
          {activity.length
            ? <div className="activity-feed">{activity.map(a => (
              <div key={a.id} className="activity-item">
                <div className="activity-dot" />
                <div className="activity-body">
                  <p className="activity-text">
                    <b>{a.actor_name || 'System'}</b> {a.body}
                  </p>
                  {a.task_title && <span className="activity-task">→ {a.task_title}</span>}
                  <span className="activity-time">{timeAgo(a.created_at)}</span>
                </div>
              </div>
            ))}</div>
            : <Empty icon={<Activity size={20} />} text="No recent activity" />
          }
        </div>

        {/* Quick Proof Feed */}
        <div className="panel">
          <SectionHead icon={<Camera size={16} />} title="Proof Feed" />
          {proofFeed.length
            ? proofFeed.slice(0, 5).map(p => (
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
            : <Empty icon={<Camera size={20} />} text="No proofs yet" />
          }
        </div>
      </div>
    </div>
  )
}

// ─── TASKS TAB ───────────────────────────────────────────────────────────────

const LAST_LOGIN_KEY = 'omnimate_last_login'

function TasksTab({ dash, token, me, reload, notify }) {
  const [tasks, setTasks] = useState([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [taskError, setTaskError] = useState('')
  const [q, setQ] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [deletingId, setDeletingId] = useState('')
  const [taskDetail, setTaskDetail] = useState(null)

  const safeDash = dash || emptyDash
  const safeMe = me || {}
  const visibleUsers = Array.isArray(safeDash.visible_users) ? safeDash.visible_users : []
  const safeTasks = Array.isArray(tasks) ? tasks : []
  const userById = useMemo(() => Object.fromEntries(visibleUsers.filter(Boolean).map(u => [u.id, u])), [visibleUsers])
  const canCreateTasks = safeMe.role !== 'INTERN'

  // Track last login time for "new task" detection
  const lastLogin = useMemo(() => {
    const stored = localStorage.getItem(LAST_LOGIN_KEY)
    if (!stored) {
      localStorage.setItem(LAST_LOGIN_KEY, new Date().toISOString())
      return new Date().toISOString()
    }
    return stored
  }, [token])

  useEffect(() => {
    let cancelled = false
    setTasksLoading(true)
    setTaskError('')
    rpc('get_tasks_rpc', { p_token: token })
      .then(data => {
        if (!cancelled) setTasks(arrayFromRpc(data, ['tasks', 'task_list', 'items']).map(normalizeTaskForUi))
      })
      .catch(ex => {
        if (!cancelled) {
          setTaskError(ex?.message || 'Unable to load tasks. Please refresh or contact admin.')
          setTasks([])
        }
      })
      .finally(() => {
        if (!cancelled) setTasksLoading(false)
      })
    return () => { cancelled = true }
  }, [token])

  // Apply search + filter on all tasks
  const searchFiltered = safeTasks.filter(t => {
    if (q && !`${t?.title || ''} ${t?.details || ''}`.toLowerCase().includes(q.toLowerCase())) return false
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

  // Bucket into views
  const lastLoginDate = new Date(lastLogin)
  const newTasks = sorted.filter(t => t.created_at && new Date(t.created_at) > lastLoginDate)
  const overdueTasks = sorted.filter(t => isOverdue(t) && t.status !== 'DONE')
  const dueSoonTasks = sorted.filter(t => !isOverdue(t) && isDueSoon(t) && t.status !== 'DONE')
  const openTasks = sorted.filter(t => t.status !== 'DONE' && !isOverdue(t) && !isDueSoon(t) && !(t.created_at && new Date(t.created_at) > lastLoginDate))
  const internManagedTasks = safeMe.role !== 'INTERN'
    ? sorted.filter(t => t.assignee_role === 'INTERN' && t.assigned_to_id !== safeMe.id)
    : []
  const completedTasks = sorted.filter(t => t.status === 'DONE')

  async function openTask(task) {
    if (!task?.id) return
    setSelectedTask(task)
    try {
      const detail = await rpc('get_task_by_id_rpc', { p_token: token, p_task_id: task.id })
      setTaskDetail(normalizeTaskForUi(objectFromRpc(detail)))
    } catch { setTaskDetail(null) }
  }

  async function setStatus(taskId, status) {
    try {
      await rpc('update_task_status_rpc', { p_token: token, p_task_id: taskId, p_status: status })
      const data = await rpc('get_tasks_rpc', { p_token: token })
      setTasks(arrayFromRpc(data, ['tasks', 'task_list', 'items']).map(normalizeTaskForUi))
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

  function canManage(task) {
    return safeMe.role === 'CEO'
      || (safeMe.role === 'BOARD' && task?.assignee_role === 'INTERN')
      || (safeMe.role === 'FOUNDER' && task?.assignee_role === 'INTERN' && task?.assigned_by_id === safeMe.id)
  }

  return (
    <div className="tab-tasks">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">Task execution</p>
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">
            {sorted.filter(t => t.status !== 'DONE').length} open
            {completedTasks.length > 0 && <span> · {completedTasks.length} completed</span>}
          </p>
        </div>
        {canCreateTasks && (
          <button className="btn btn-primary" onClick={() => setShowAssign(true)}>
            <Plus size={16} /> New Task
          </button>
        )}
      </div>

      {taskError && (
        <div className="notice notice-error">Unable to load tasks. Please refresh or contact admin.</div>
      )}

      {/* Search */}
      <div className="task-search-wrap">
        <Search size={15} className="task-search-icon" />
        <input className="input task-search-input" placeholder="Search tasks..." value={q}
          onChange={e => setQ(e.target.value)} />
      </div>

      {/* Task Lists */}
      <div className={`task-lists ${selectedTask ? 'with-panel' : ''}`}>
        <div className="task-main-col">

          {/* NEW ASSIGNED — only if any */}
          {newTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-head task-section-new">
                <span className="task-section-label">
                  <Zap size={13} /> New Assigned
                </span>
                <span className="task-section-count">{newTasks.length}</span>
              </div>
              {newTasks.map(t => (
                <TaskRow key={t.id} task={t} userById={userById} me={safeMe} onOpen={() => openTask(t)}
                  onSetStatus={setStatus} onDelete={deleteTask} canManage={canManage(t)}
                  isDeleting={deletingId === t.id} isSelected={selectedTask?.id === t.id}
                  isNew lastLoginDate={lastLoginDate} />
              ))}
            </div>
          )}

          {/* OVERDUE */}
          {overdueTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-head task-section-overdue">
                <span className="task-section-label">
                  <AlertCircle size={13} /> Overdue
                </span>
                <span className="task-section-count">{overdueTasks.length}</span>
              </div>
              {overdueTasks.map(t => (
                <TaskRow key={t.id} task={t} userById={userById} me={safeMe} onOpen={() => openTask(t)}
                  onSetStatus={setStatus} onDelete={deleteTask} canManage={canManage(t)}
                  isDeleting={deletingId === t.id} isSelected={selectedTask?.id === t.id}
                  isOverdue />
              ))}
            </div>
          )}

          {/* DUE SOON */}
          {dueSoonTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-head task-section-soon">
                <span className="task-section-label">
                  <Clock size={13} /> Due Soon
                </span>
                <span className="task-section-count">{dueSoonTasks.length}</span>
              </div>
              {dueSoonTasks.map(t => (
                <TaskRow key={t.id} task={t} userById={userById} me={safeMe} onOpen={() => openTask(t)}
                  onSetStatus={setStatus} onDelete={deleteTask} canManage={canManage(t)}
                  isDeleting={deletingId === t.id} isSelected={selectedTask?.id === t.id}
                  isDueSoon />
              ))}
            </div>
          )}

          {/* OPEN TASKS */}
          {openTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-head">
                <span className="task-section-label">Open Tasks</span>
                <span className="task-section-count">{openTasks.length}</span>
              </div>
              {openTasks.map(t => (
                <TaskRow key={t.id} task={t} userById={userById} me={safeMe} onOpen={() => openTask(t)}
                  onSetStatus={setStatus} onDelete={deleteTask} canManage={canManage(t)}
                  isDeleting={deletingId === t.id} isSelected={selectedTask?.id === t.id} />
              ))}
            </div>
          )}

          {/* Intern work managed by leadership */}
          {internManagedTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-head">
                <span className="task-section-label">Intern Tasks I Manage</span>
                <span className="task-section-count">{internManagedTasks.length}</span>
              </div>
              {internManagedTasks.map(t => (
                <TaskRow key={t.id} task={t} userById={userById} me={safeMe} onOpen={() => openTask(t)}
                  onSetStatus={setStatus} onDelete={deleteTask} canManage={canManage(t)}
                  isDeleting={deletingId === t.id} isSelected={selectedTask?.id === t.id}
                  isManagedIntern />
              ))}
            </div>
          )}

          {/* COMPLETED */}
          {completedTasks.length > 0 && (
            <div className="task-section">
              <button className="task-section-toggle" onClick={() => setShowCompleted(v => !v)}>
                <span className="task-section-label">Completed</span>
                <div className="task-section-toggle-right">
                  <span className="task-section-count">{completedTasks.length}</span>
                  <ChevronDown size={14} className={`toggle-icon ${showCompleted ? 'open' : ''}`} />
                </div>
              </button>
              {showCompleted && completedTasks.map(t => (
                <TaskRow key={t.id} task={t} userById={userById} me={safeMe} onOpen={() => openTask(t)}
                  onSetStatus={setStatus} onDelete={deleteTask} canManage={canManage(t)}
                  isDeleting={deletingId === t.id} isSelected={selectedTask?.id === t.id}
                  isDone />
              ))}
            </div>
          )}

          {/* Empty state */}
          {sorted.filter(t => t.status !== 'DONE').length === 0 && !tasksLoading && (
            <div className="tasks-empty">
              <CheckCircle size={32} className="tasks-empty-icon" />
              <b>All clear</b>
              <p>No open tasks. You're up to date.</p>
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
              if (d) setTaskDetail(d)
            }}
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
            const data = await rpc('get_tasks_rpc', { p_token: token })
            const nextTasks = arrayFromRpc(data, ['tasks', 'task_list', 'items']).map(normalizeTaskForUi)
            setTasks(nextTasks)
            const t = nextTasks.find(t => t.id === taskId)
            if (t) openTask(t)
            notify('Task created')
          }}
          notify={notify}
        />
      )}
    </div>
  )
}

// ─── Task Row ────────────────────────────────────────────────────────────────

function TaskRow({ task, userById, onOpen, onSetStatus, onDelete, canManage, isDeleting, isSelected, isNew, isOverdue, isDueSoon, isManagedIntern, isDone, me }) {
  const safeTask = normalizeTaskForUi(task)
  const safeMe = me || {}
  const assignee = userById[safeTask.assigned_to_id] || { name: safeTask.assigned_to, strikes: 0 }
  const isForMe = safeTask.assigned_to_id === safeMe.id
  const statusLabel = String(safeTask.status || 'TODO').replace('_', ' ')

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

          {Array.isArray(safeTask.proofs) && safeTask.proofs.length > 0 && (
            <span className="task-row-proof">
              <Camera size={11} /> {safeTask.proofs.length} proof{safeTask.proofs.length === 1 ? '' : 's'}
            </span>
          )}

          {/* State labels */}
          {isNew && <span className="task-row-new-badge">New</span>}
          {isOverdue && <span className="task-row-overdue-badge">Overdue</span>}
          {Number(assignee.strikes) > 0 && <StrikeBadge count={assignee.strikes} />}
        </div>
      </div>

      {/* Status quick-change */}
      {isForMe && !isDone && (
        <select className="task-row-status"
          value={safeTask.status}
          onChange={e => { e.stopPropagation(); onSetStatus(safeTask.id, e.target.value) }}
          onClick={e => e.stopPropagation()}>
          <option>TODO</option><option>IN_PROGRESS</option><option>SUBMITTED</option><option>DONE</option><option>BLOCKED</option>
        </select>
      )}
    </div>
  )
}

function TaskDetailPanel({ task, detail, me, token, onClose, onStatusChange, onDelete, notify }) {
  const safeTask = normalizeTaskForUi(detail || task)
  const safeMe = me || {}
  const panelRef = useRef(null)
  const previousFocusRef = useRef(null)
  const [comment, setComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [comments, setComments] = useState(Array.isArray(detail?.comments) ? detail.comments : [])
  const [activity, setActivity] = useState([])

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
    rpc('get_activity_timeline_rpc', { p_token: token, p_task_id: safeTask.id, p_limit: 30 })
      .then(data => setActivity(arrayFromRpc(data, ['data', 'items', 'activity'])))
      .catch(() => {})
  }, [safeTask?.id, token])

  useEffect(() => {
    if (Array.isArray(detail?.comments)) setComments(detail.comments)
  }, [detail?.comments])

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

  const proofs = Array.isArray(detail?.proofs) ? detail.proofs : []
  const assignee = detail?.assigned_to_name || safeTask?.assigned_to || 'Unassigned'
  const assigner = detail?.assigned_by_name || safeTask?.assigned_by_name || 'Unknown'
  const statusLabel = String(safeTask.status || 'TODO').replace('_', ' ')

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

      {/* Status changer */}
      <div className="detail-section detail-status-section">
        <div className="detail-label"><CheckCircle size={14} /> Status</div>
        <select className="input status-select" value={safeTask.status}
          onChange={e => onStatusChange(e.target.value)}>
          <option>TODO</option><option>IN_PROGRESS</option><option>SUBMITTED</option><option>DONE</option><option>BLOCKED</option>
        </select>
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
                <img className="proof-img" src={p.screenshot_data_url} alt="Proof screenshot" loading="lazy" />
              )}
            </div>
          ))
          : <p className="muted small">No proofs submitted.</p>
        }
      </div>

      {/* Activity Timeline */}
      <div className="detail-section">
        <div className="detail-label"><Activity size={14} /> Activity ({activity.length})</div>
        <div className="timeline">
          {activity.slice(0, 15).map(a => (
            <div key={a.id} className="timeline-item">
              <div className="timeline-dot" />
              <div>
                <p className="timeline-text"><b>{a.actor_name || 'System'}</b> {a.body}</p>
                <span className="timeline-time muted">{timeAgo(a.created_at)}</span>
              </div>
            </div>
          ))}
          {activity.length === 0 && <p className="muted small">No activity yet.</p>}
        </div>
      </div>

      {/* Danger Zone */}
      {safeMe.role === 'CEO' && (
        <div className="detail-danger">
          <button className="btn btn-danger btn-sm" onClick={onDelete}>
            <Trash2 size={14} /> Delete this task
          </button>
        </div>
      )}
      </aside>
    </>
  )
}

// ─── Assign Modal ─────────────────────────────────────────────────────────────

function AssignModal({ token, users, me, onClose, onCreated, notify }) {
  // CEO can assign to founders + interns. Others can assign to interns only.
  const assignableUsers = useMemo(() => {
    if (me.role === 'CEO') {
      return users.filter(u => u.role !== 'CEO' && u.role !== 'BOARD')
    }
    return users.filter(u => u.role === 'INTERN')
  }, [users, me.role])

  const [f, setF] = useState({ title: '', details: '', assigned_to: '', priority: 'HIGH', due_date: '' })
  const [saving, setSaving] = useState(false)

  if (me?.role === 'INTERN') return null

  async function submit(e) {
    e.preventDefault()
    if (!f.assigned_to || !f.title.trim()) return
    setSaving(true)
    try {
      const result = await rpc('create_task_rpc', {
        p_token: token, p_title: f.title, p_details: f.details,
        p_assigned_to: f.assigned_to, p_priority: f.priority, p_due_date: f.due_date || null
      })
      onCreated(result.id)
    } catch (ex) { notify(ex.message, 'error') }
    finally { setSaving(false) }
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
          <button className="btn btn-primary btn-full" type="submit" disabled={saving}>
            {saving ? 'Creating...' : 'Create Task'}
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

  const people = dash.visible_users || []
  const founderRank = dash.founder_ranking || []
  const internRank = dash.intern_ranking || []

  async function viewProfile(user) {
    setSelectedUser(user)
    setLoadingProfile(true)
    try {
      const p = await rpc('get_person_profile', { p_token: token, p_user_id: user.id })
      setProfile(p)
    } catch (ex) { notify(ex.message, 'error'); setProfile(null) }
    finally { setLoadingProfile(false) }
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
              <button className="icon-btn icon-btn-sm" onClick={() => { setSelectedUser(null); setProfile(null) }}>
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
              </div>
            ) : (
              <p className="muted">Profile not available.</p>
            )}
          </div>
        )}
      </div>

      {/* Rankings */}
      {founderRank.length > 0 && me.role !== 'INTERN' && (
        <div className="panel ranking-panel">
          <SectionHead icon={<Trophy size={16} />} title="Founding Member Rankings" />
          <div className="ranking-list">
            {founderRank.map(r => (
              <div key={r.id} className={`rank-row ${r.strikes >= 3 ? 'rank-danger' : ''}`}>
                <div className="rank-pos">#{r.rank}</div>
                <div className="rank-info">
                  <b>{r.name}</b>
                  <span className="muted small">{r.title} · {r.done}/{r.total} done</span>
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
                  <span className="muted small">{r.title} · {r.done}/{r.total} done</span>
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

createRoot(document.getElementById('root')).render(<App />)
