import {Lightbulb, MessageCircle, TrendingUp} from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import Badge from './Badge'

function getIdeaStatus(idea) {
  return idea?.status || idea?.stage || idea?.decision_status || 'Open'
}

function getVoteCount(idea) {
  const count = idea?.votes ?? idea?.vote_count ?? idea?.score ?? 0
  return Number.isFinite(Number(count)) ? Number(count) : 0
}

const IdeaCard = memo(function IdeaCard({ idea, className = '', ...props }) {
  const isInteractive = typeof props.onClick === 'function'
  const [voted, setVoted] = useState(false)
  const [comment, setComment] = useState('')
  const [notes, setNotes] = useState([])
  const voteCount = getVoteCount(idea) + (voted ? 1 : 0)
  const status = getIdeaStatus(idea)
  const owner = idea?.owner_name || idea?.created_by_name || idea?.author || idea?.owner || 'Team idea'
  const discussionCount = notes.length + Number(idea?.comment_count || idea?.comments_count || 0)
  const isTrending = voteCount >= 3 || discussionCount >= 2
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
          <p className="muted">Owned by {owner}</p>
        </div>
        <Badge className={statusClass}>{status}</Badge>
      </div>
      <p className="idea-card-copy">{idea?.description || idea?.summary || 'Idea details unavailable.'}</p>
      <div className="idea-signal-row">
        <button type="button" className={voted ? 'is-active' : ''} onClick={() => setVoted(current => !current)}>
          <TrendingUp size={15} />
          {voteCount} votes
        </button>
        <span><MessageCircle size={15} /> {discussionCount} comments</span>
        {isTrending && <Badge className="task-priority-medium">Trending</Badge>}
      </div>
      <form className="idea-discussion-form" onSubmit={event => {
        event.preventDefault()
        const body = comment.trim()
        if (!body) return
        setNotes(current => [{id: Date.now(), body}, ...current])
        setComment('')
      }}>
        <input
          aria-label="Add idea discussion note"
          value={comment}
          onChange={event => setComment(event.target.value)}
          placeholder="Add a discussion note"
        />
        <button type="submit">Add</button>
      </form>
      {notes.length > 0 && (
        <div className="idea-notes">
          {notes.slice(0, 2).map(note => <p key={note.id}>{note.body}</p>)}
        </div>
      )}
    </article>
  )
})

export default IdeaCard
