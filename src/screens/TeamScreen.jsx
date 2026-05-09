import Avatar from '../components/Avatar'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import OperationalActivityFeed from '../components/OperationalActivityFeed'
import ScreenLoader from '../components/ScreenLoader'
import {useDashboardContext} from '../context/DashboardContext'
import {roleLabel} from '../lib/utils'

function isDone(task) {
  return String(task?.status || '').toUpperCase() === 'DONE'
}

function isBlocked(task) {
  return String(task?.status || '').toUpperCase() === 'BLOCKED'
}

function isOverdue(task) {
  if (isDone(task) || !task?.due_date) return false
  const due = new Date(task.due_date)
  if (Number.isNaN(due.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  return due < today
}

function ownerId(task) {
  return task?.assignee?.id || task?.assigned_to_id || task?.assignee_id || task?.assigned_to || ''
}

function statsForUser(user, tasks) {
  const owned = tasks.filter(task => String(ownerId(task)) === String(user?.id) || task?.assignee?.name === user?.name || task?.assigned_to === user?.name)
  return {
    active: owned.filter(task => !isDone(task)).length,
    completed: owned.filter(isDone).length,
    overdue: owned.filter(isOverdue).length,
    blocked: owned.filter(isBlocked).length,
    recent: owned.slice(0, 3)
  }
}

export default function TeamScreen() {
  const {tasks, visibleUsers, loading, error, refresh} = useDashboardContext()
  const safeTasks = Array.isArray(tasks) ? tasks : []
  const safeUsers = Array.isArray(visibleUsers) ? visibleUsers : []
  const activeTasks = safeTasks.filter(task => !isDone(task))
  const overdueTasks = safeTasks.filter(isOverdue)
  const blockedTasks = safeTasks.filter(isBlocked)
  const completedTasks = safeTasks.filter(isDone)

  return (
    <>
      <header className="screen-header">
        <div className="top">
          <div>
            <p className="eyebrow">Team operations</p>
            <h1>Team</h1>
            <p className="muted">Capacity, blocked work, and contribution signals for the people moving the company.</p>
          </div>
        </div>
      </header>
      <ScreenLoader
        loading={loading}
        error={error}
        isEmpty={safeUsers.length === 0}
        emptyTitle="Team insights are not available yet."
        emptyDescription="Once teammates appear in the workspace, this space will show capacity, ownership, and support signals."
        onRetry={refresh}
      >
        <section className="team-command-grid">
          <div className="panel team-scoreboard">
            <div className="section-title">
              <h2>Operating pulse</h2>
            </div>
            <div className="stats ops-stats">
              <div className="stat">
                <div className="stat-icon">A</div>
                <div><b>{activeTasks.length}</b><span>Active tasks</span></div>
              </div>
              <div className="stat">
                <div className="stat-icon">C</div>
                <div><b>{completedTasks.length}</b><span>Completed</span></div>
              </div>
              <div className="stat danger-stat">
                <div className="stat-icon">O</div>
                <div><b>{overdueTasks.length}</b><span>Overdue</span></div>
              </div>
              <div className="stat danger-stat">
                <div className="stat-icon">B</div>
                <div><b>{blockedTasks.length}</b><span>Blocked</span></div>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="section-title">
              <h2>Team activity</h2>
            </div>
            <OperationalActivityFeed tasks={safeTasks} limit={5} />
          </div>
        </section>
        <section className="panel team-roster-panel">
          <div className="section-title">
            <h2>Workload overview</h2>
            <Badge>{safeUsers.length} teammates</Badge>
          </div>
          <div className="team-roster">
            {safeUsers.map(user => {
              const userStats = statsForUser(user, safeTasks)
              const loadLevel = userStats.blocked || userStats.overdue ? 'Needs support' : userStats.active > 4 ? 'High load' : userStats.active ? 'In motion' : 'Available'
              return (
                <article className="teammate-card" key={user?.id || user?.name}>
                  <div className="teammate-header">
                    <Avatar user={user} size={48} />
                    <div>
                      <h3>{user?.name || 'Team member'}</h3>
                      <p className="muted">{user?.title || roleLabel(user?.role) || 'Contributor'}</p>
                    </div>
                    <Badge className={userStats.blocked || userStats.overdue ? 'task-priority-high' : 'role-badge'}>{loadLevel}</Badge>
                  </div>
                  <div className="teammate-stats">
                    <span><strong>{userStats.active}</strong> active</span>
                    <span><strong>{userStats.completed}</strong> done</span>
                    <span><strong>{userStats.overdue}</strong> overdue</span>
                    <span><strong>{userStats.blocked}</strong> blocked</span>
                  </div>
                  {userStats.recent.length ? (
                    <div className="teammate-work">
                      {userStats.recent.map(task => <span key={task.id}>{task.title}</span>)}
                    </div>
                  ) : (
                    <EmptyState title="No assigned work" description="This teammate has no active task signals in the current dashboard." />
                  )}
                </article>
              )
            })}
          </div>
        </section>
      </ScreenLoader>
    </>
  )
}
