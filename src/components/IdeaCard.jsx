import {Clock3, Lightbulb, MessageCircle, TrendingUp, User2} from 'lucide-react'
import { memo, useMemo } from 'react'
import Badge from './Badge'

function getIdeaStatus(idea) {
  return idea?.status || idea?.stage || idea?.decision_status || 'Open'
}

function getVoteCount(idea) {
  const count = idea?.vote_count ?? idea?.votes ?? idea?.score ?? 0
  return Number.isFinite(Number(count)) ? Number(count) : 0
}

function getDiscussionCount(idea) {
  const count = idea?.discussion_count ?? idea?.comment_count ?? idea?.comments_count ?? 0
  return Number.isFinite(Number(count)) ? Number(count) : 0
}

function formatIdeaDate(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(parsed)
}

function formatStatus(status) {
  return String(status || 'PENDING').replace(/_/g, ' ').toLowerCase().replace(/^\w/, char => char.toUpperCase())
}

const IdeaCard = memo(function IdeaCard({ idea, className = '', ...props }) {
  const isInteractive = typeof props.onClick === 'function'
  const voteCount = getVoteCount(idea)
  const status = getIdeaStatus(idea)
  const owner = idea?.submitted_by_name || idea?.owner_name || idea?.created_by_name || idea?.author || idea?.owner || 'Team idea'
  const discussionCount = getDiscussionCount(idea)
  const isTrending = voteCount >= 3 || discussionCount >= 2
  const createdAt = formatIdeaDate(idea?.created_at || idea?.createdAt)
  const statusClass = useMemo(() => {
    const normalized = String(status).toLowerCase()
    if (normalized.includes('approved') || normalized.includes('active')) return 'task-priority-low'
    if (normalized.includes('review') || normalized.includes('explor')) return 'task-priority-medium'
    if (normalized.includes('reject') || normalized.includes('blocked')) return 'task-priority-high'
    return 'role-badge'
  }, [status])

  return (
    <article
      className={`idea-card ${isInteractive ? 'is-interactive' : ''} ${className}`.trim()}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      {...props}
    >
      <div className="idea-card-header">
        <span className="idea-symbol" aria-hidden="true"><Lightbulb size={18} /></span>
        <div>
          <h3>{idea?.title || idea?.name || 'Untitled idea'}</h3>
          <p className="muted">Submitted by {owner}</p>
        </div>
        <Badge className={statusClass}>{formatStatus(status)}</Badge>
      </div>
      <p className="idea-card-copy">{idea?.description || idea?.summary || 'Idea details unavailable.'}</p>
      <div className="idea-signal-row">
        <span>
          <TrendingUp size={15} />
          {voteCount} votes
        </span>
        <span><MessageCircle size={15} /> {discussionCount} comments</span>
        <span><User2 size={15} /> {idea?.submitted_by_role || 'Team'}</span>
        {createdAt && <span><Clock3 size={15} /> {createdAt}</span>}
        {isTrending && <Badge className="task-priority-medium">Trending</Badge>}
      </div>
      {idea?.decision_note && <p className="idea-decision-note">{idea.decision_note}</p>}
    </article>
  )
})

export default IdeaCard
