import React, {useEffect, useMemo, useState, useCallback} from 'react'
import {createRoot} from 'react-dom/client'
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Bell,
  Camera,
  CheckCircle,
  ChevronDown,
  ClipboardList,
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
  if (role === 'CEO') return 'CEO'
  if (role === 'FOUNDER') return 'Founder'
  return role || ''
}

function displayStatusBadge(status) {
  const map = { TODO: 'todo', IN_PROGRESS: 'in_progress', SUBMITTED: 'submitted', DONE: 'done', BLOCKED: 'blocked' }
  return map[status] || 'todo'
}

function priorityClass(p) {
  return { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', URGENT: 'urgent' }[p] || 'medium'
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

function Empty({ text, icon }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <span>{text}</span>
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
  return (
    <nav className="navbar">
      <div className="nav-brand">
        <div className="nav-logo">OM</div>
        <span className="nav-title">Omnimate</span>
      </div>
      <div className="nav-items">
        {NAV.map(n => (
          <button key={n.id} className={`nav-item ${tab === n.id ? 'active' : ''}`} onClick={() => setTab(n.id)}>
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
        <button className="icon-btn" onClick={onLogout} title="Logout"><LogOut size={16} /></button>
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
        {tab === 'home'   && <HomeTab   dash={dash} token={token} me={dash.me} reload={load} notify={notify} />}
        {tab === 'tasks' && <TasksTab  dash={dash} token={token} me={dash.me} reload={load} notify={notify} />}
        {tab === 'ideas' && <IdeasTab  dash={dash} token={token} me={dash.me} reload={load} notify={notify} />}
        {tab === 'team'  && <TeamTab   dash={dash} token={token} me={dash.me} reload={load} notify={notify} />}
        {tab === 'more'  && <MoreTab   dash={dash} token={token} me={dash.me} reload={load} notify={notify} />}
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
    <div className="tab-home">
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

      {/* Overview Stats */}
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

      {/* Attention Signals Grid */}
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

function TasksTab({ dash, token, me, reload, notify }) {
  const [tasks, setTasks] = useState([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [showAssign, setShowAssign] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [deletingId, setDeletingId] = useState('')

  const [taskDetail, setTaskDetail] = useState(null)
  const userById = useMemo(() => Object.fromEntries((dash.visible_users || []).map(u => [u.id, u])), [dash.visible_users])

  useEffect(() => {
    setTasksLoading(true)
    rpc('get_tasks_rpc', { p_token: token })
      .then(data => setTasks(data.tasks || []))
      .catch(() => setTasks([]))
      .finally(() => setTasksLoading(false))
  }, [token])

  const filtered = tasks.filter(t => {
    if (q && !`${t.title} ${t.details}`.toLowerCase().includes(q.toLowerCase())) return false
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false
    return true
  })

  const myTasks = filtered.filter(t => t.assigned_to_id === me.id)
  const internTasks = filtered.filter(t => t.assignee_role === 'INTERN' && t.assigned_to_id !== me.id)
  const founderTasks = filtered.filter(t => t.assigned_to_id !== me.id && t.assignee_role !== 'INTERN')

  async function openTask(task) {
    setSelectedTask(task)
    try {
      const detail = await rpc('get_task_by_id_rpc', { p_token: token, p_task_id: task.id })
      setTaskDetail(detail)
    } catch {
      setTaskDetail(null)
    }
  }

  async function setStatus(taskId, status) {
    try {
      await rpc('update_task_status_rpc', { p_token: token, p_task_id: taskId, p_status: status })
      const data = await rpc('get_tasks_rpc', { p_token: token })
      setTasks(data.tasks || [])
      if (selectedTask?.id === taskId) {
        const detail = await rpc('get_task_by_id_rpc', { p_token: token, p_task_id: taskId }).catch(() => null)
        if (detail) setTaskDetail(detail)
      }
      notify('Status updated')
    } catch (ex) { notify(ex.message, 'error') }
  }

  async function deleteTask(task) {
    if (!window.confirm(`Delete "${task.title}"?`)) return
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
    return me.role === 'CEO'
      || (me.role === 'BOARD' && task.assignee_role === 'INTERN')
      || (me.role === 'FOUNDER' && task.assignee_role === 'INTERN' && task.assigned_by_id === me.id)
  }

  return (
    <div className="tab-tasks">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">Task execution</p>
          <h1 className="page-title">Tasks</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAssign(true)}>
          <Plus size={16} /> New Task
        </button>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="search-wrap">
          <Search size={15} className="search-icon" />
          <input className="input search-input" placeholder="Search tasks..." value={q}
            onChange={e => setQ(e.target.value)} />
        </div>
        <div className="filter-pills">
          {['ALL', 'TODO', 'IN_PROGRESS', 'SUBMITTED', 'DONE', 'BLOCKED'].map(s => (
            <button key={s} className={`filter-pill ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}>
              {s === 'ALL' ? 'All' : s.replace('_', ' ')}
            </button>
          ))}
        </div>
        {tasksLoading && <span className="loading">Loading...</span>}
      </div>

      {/* Task Lists */}
      <div className={`task-lists ${selectedTask ? 'with-panel' : ''}`}>
        <div className="task-main-col">
          {myTasks.length > 0 && (
            <div className="task-group">
              <div className="group-label">My Tasks <span className="group-count">{myTasks.length}</span></div>
              {myTasks.map(t => (
                <TaskCard key={t.id} task={t} userById={userById} onOpen={() => openTask(t)}
                  onSetStatus={setStatus} onDelete={deleteTask} canManage={canManage(t)}
                  isDeleting={deletingId === t.id} isSelected={selectedTask?.id === t.id} me={me} />
              ))}
            </div>
          )}
          {internTasks.length > 0 && (me.role !== 'INTERN') && (
            <div className="task-group">
              <div className="group-label">Intern Tasks <span className="group-count">{internTasks.length}</span></div>
              {internTasks.map(t => (
                <TaskCard key={t.id} task={t} userById={userById} onOpen={() => openTask(t)}
                  onSetStatus={setStatus} onDelete={deleteTask} canManage={canManage(t)}
                  isDeleting={deletingId === t.id} isSelected={selectedTask?.id === t.id} me={me} />
              ))}
            </div>
          )}
          {founderTasks.length > 0 && me.role === 'CEO' && (
            <div className="task-group">
              <div className="group-label">Founder Tasks <span className="group-count">{founderTasks.length}</span></div>
              {founderTasks.map(t => (
                <TaskCard key={t.id} task={t} userById={userById} onOpen={() => openTask(t)}
                  onSetStatus={setStatus} onDelete={deleteTask} canManage={canManage(t)}
                  isDeleting={deletingId === t.id} isSelected={selectedTask?.id === t.id} me={me} />
              ))}
            </div>
          )}
          {filtered.length === 0 && (
            <Empty icon={<ClipboardList size={24} />} text="No tasks match your filter" />
          )}
        </div>

        {/* Task Detail Panel */}
        {selectedTask && (
          <TaskDetailPanel
            task={selectedTask}
            detail={taskDetail}
            me={me}
            token={token}
            onClose={() => { setSelectedTask(null); setTaskDetail(null) }}
            onStatusChange={(s) => setStatus(selectedTask.id, s)}
            onDelete={() => deleteTask(selectedTask)}
            onReload={async () => {
              await reload()
              const d = await rpc('get_task_by_id_rpc', { p_token: token, p_task_id: selectedTask.id }).catch(() => null)
              if (d) setTaskDetail(d)
            }}
            notify={notify}
          />
        )}
      </div>

      {/* Assign Modal */}
      {showAssign && (
        <AssignModal
          token={token}
          users={dash.visible_users || []}
          me={me}
          onClose={() => setShowAssign(false)}
          onCreated={async (taskId) => {
            setShowAssign(false)
            const data = await rpc('get_tasks_rpc', { p_token: token })
            setTasks(data.tasks || [])
            const t = (data.tasks || []).find(t => t.id === taskId)
            if (t) openTask(t)
            notify('Task created')
          }}
          notify={notify}
        />
      )}
    </div>
  )
}

function TaskCard({ task, userById, onOpen, onSetStatus, onDelete, canManage, isDeleting, isSelected, me }) {
  const overdue = isOverdue(task)
  const assignee = userById[task.assigned_to_id] || {}

  return (
    <div className={`task-card ${isSelected ? 'task-selected' : ''} ${overdue ? 'task-overdue' : ''}`}
      onClick={onOpen} role="button">
      <div className="task-card-head">
        <div className="task-card-title">{task.title}</div>
        {canManage && (
          <button className="icon-btn icon-btn-sm danger-btn" onClick={e => { e.stopPropagation(); onDelete() }}
            disabled={isDeleting} aria-label="Delete">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {task.details && <p className="task-card-desc muted">{task.details.substring(0, 80)}{task.details.length > 80 ? '…' : ''}</p>}
      <div className="task-card-meta">
        <Badge variant={`badge-${displayStatusBadge(task.status)}`}>{task.status.replace('_', ' ')}</Badge>
        <Badge variant={`badge-${priorityClass(task.priority)}`}>{task.priority}</Badge>
        <span className="meta-sep" />
        <span className="task-meta-user">{assignee.name}</span>
        {task.due_date && (
          <span className={`task-meta-date ${overdue ? 'text-overdue' : ''}`}>
            {niceDate(task.due_date)}
          </span>
        )}
        {overdue && <Badge variant="badge-overdue">Overdue</Badge>}
        {assignee.strikes > 0 && <StrikeBadge count={assignee.strikes} />}
      </div>
    </div>
  )
}

function TaskDetailPanel({ task, detail, me, token, onClose, onStatusChange, onDelete, onReload, notify }) {
  const [comment, setComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [comments, setComments] = useState(detail?.comments || [])
  const [activity, setActivity] = useState([])

  // Load activity timeline
  useEffect(() => {
    if (!task?.id) return
    rpc('get_activity_timeline_rpc', { p_token: token, p_task_id: task.id, p_limit: 30 })
      .then(data => setActivity(data || []))
      .catch(() => {})
  }, [task?.id, token])

  useEffect(() => {
    if (detail?.comments) setComments(detail.comments)
  }, [detail?.comments])

  async function submitComment(e) {
    e.preventDefault()
    if (!comment.trim()) return
    setSubmittingComment(true)
    try {
      await rpc('add_task_comment_rpc', { p_token: token, p_task_id: task.id, p_body: comment })
      const data = await rpc('get_task_comments_rpc', { p_token: token, p_task_id: task.id })
      setComments(data || [])
      setComment('')
      await onReload()
      notify('Comment added')
    } catch (ex) { notify(ex.message, 'error') }
    finally { setSubmittingComment(false) }
  }

  const proofs = detail?.proofs || []
  const assignee = detail?.assigned_to_name || task?.assigned_to || ''
  const assigner = detail?.assigned_by_name || task?.assigned_by_name || ''

  return (
    <div className="task-detail-panel">
      <div className="detail-header">
        <div>
          <Badge variant={`badge-${displayStatusBadge(task.status)}`}>{task.status.replace('_', ' ')}</Badge>
          <Badge variant={`badge-${priorityClass(task.priority)}`}>{task.priority}</Badge>
        </div>
        <button className="icon-btn icon-btn-sm" onClick={onClose}><X size={16} /></button>
      </div>

      <div className="detail-title">{task.title}</div>
      {task.details && <p className="detail-desc muted">{task.details}</p>}

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
          <span className={`meta-val ${isOverdue(task) ? 'text-overdue' : ''}`}>{niceDate(task.due_date)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Time logged</span>
          <span className="meta-val">{task.minutes || 0}m</span>
        </div>
      </div>

      {/* Status changer */}
      <div className="detail-section">
        <div className="detail-label"><CheckCircle size={14} /> Status</div>
        <select className="input status-select" value={task.status}
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
                <img className="proof-img" src={p.screenshot_data_url} alt="proof screenshot" />
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
      {me.role === 'CEO' && (
        <div className="detail-danger">
          <button className="btn btn-danger btn-sm" onClick={onDelete}>
            <Trash2 size={14} /> Delete this task
          </button>
        </div>
      )}
    </div>
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
                <option key={u.id} value={u.id}>{u.name} — {u.title} ({u.role})</option>
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
          <p className="page-eyebrow">Idea board</p>
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
                onClick={() => viewProfile(u)} role="button">
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
          <SectionHead icon={<Trophy size={16} />} title="Founder Rankings" />
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
                      <span className="best-label">Best Founder</span>
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