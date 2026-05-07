import {useState} from 'react'
import Button from '../Button'
import Skeleton from '../Skeleton'

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(date)
}

export default function TaskCommentList({comments = [], loading, onAddComment}) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    const note = body.trim()
    if (!note) return

    setSaving(true)
    setError('')
    try {
      await onAddComment?.(note)
      setBody('')
    } catch (err) {
      setError(err?.message || 'Comment could not be added.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="task-drawer-section">
      <div className="section-title">
        <h2>Comments</h2>
      </div>
      <form className="comment-form" onSubmit={handleSubmit}>
        <textarea
          className="field-control"
          value={body}
          onChange={event => setBody(event.target.value)}
          placeholder="Add a comment or work note"
          rows={3}
        />
        {error && <p className="field-error">{error}</p>}
        <Button variant="primary" type="submit" loading={saving} disabled={saving || !body.trim()}>Comment</Button>
      </form>
      {loading ? (
        <Skeleton.List rows={3} />
      ) : comments.length === 0 ? (
        <p className="task-empty-note">No comments yet.</p>
      ) : (
        <div className="comment-list">
          {comments.map(comment => (
            <article className="comment-item" key={comment.id}>
              <div className="comment-header">
                <strong>{comment.author}</strong>
                <span>{formatDateTime(comment.createdAt)}</span>
              </div>
              <p>{comment.body || 'No note provided.'}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
