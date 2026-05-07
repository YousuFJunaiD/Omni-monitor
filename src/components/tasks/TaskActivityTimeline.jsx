import Skeleton from '../Skeleton'
import Avatar from '../Avatar'
import {CheckCircle2, MessageSquare, Send, ShieldAlert, Sparkles, UserRoundPlus} from 'lucide-react'

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(date)
}

function getActivityIcon(type) {
  const normalized = String(type || '').toLowerCase()
  if (normalized.includes('complete') || normalized.includes('done')) return <CheckCircle2 size={15} />
  if (normalized.includes('comment')) return <MessageSquare size={15} />
  if (normalized.includes('submit') || normalized.includes('proof')) return <Send size={15} />
  if (normalized.includes('blocked') || normalized.includes('reject')) return <ShieldAlert size={15} />
  if (normalized.includes('assign')) return <UserRoundPlus size={15} />
  return <Sparkles size={15} />
}

function groupItems(items) {
  return items.reduce((groups, item) => {
    const date = new Date(item.createdAt)
    const key = Number.isNaN(date.getTime())
      ? 'Recent'
      : new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(date)
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
    return groups
  }, {})
}

export default function TaskActivityTimeline({items = [], loading, task, onOpenTask}) {
  const grouped = groupItems(items)

  return (
    <section className="task-drawer-section">
      <div className="section-title">
        <div>
          <h2>Activity</h2>
          <p className="muted">A working history of decisions, handoffs, and progress.</p>
        </div>
      </div>
      {loading ? (
        <Skeleton.List rows={4} />
      ) : items.length === 0 ? (
        <p className="task-empty-note">Activity will appear as teammates comment, submit proof, and move this task.</p>
      ) : (
        <div className="timeline-groups">
          {Object.entries(grouped).map(([date, group]) => (
            <section className="timeline-group" key={date}>
              <h3>{date}</h3>
              <ol className="timeline-list">
                {group.map(item => (
                  <li className={`timeline-item timeline-${item.type || 'event'}`} key={item.id}>
                    <span className="timeline-dot" aria-hidden="true">{getActivityIcon(item.type)}</span>
                    <button type="button" onClick={() => onOpenTask?.(task)} disabled={!onOpenTask || !task}>
                      <div className="timeline-header">
                        <span className="timeline-actor">
                          <Avatar user={{name: item.actor || 'System'}} size={24} />
                          <strong>{item.label}</strong>
                        </span>
                        <time>{formatDateTime(item.createdAt)}</time>
                      </div>
                      <p>{item.actor ? `${item.actor}: ${item.body}` : item.body}</p>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
