import {useEffect, useMemo, useRef, useState} from 'react'
import Button from './Button'
import Field from './Field'
import {IDEA_PRIORITIES} from '../services/ideaService'

const initialForm = {
  title: '',
  description: '',
  why: '',
  suggested_owner: '',
  priority: 'MEDIUM',
  tags: ''
}

export default function CreateIdeaModal({open, users = [], onClose, onSubmit}) {
  const dialogRef = useRef(null)
  const titleRef = useRef(null)
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const ownerOptions = useMemo(() => (
    Array.isArray(users) ? users.filter(user => user?.name || user?.username) : []
  ), [users])

  useEffect(() => {
    if (!open) return

    const frame = window.requestAnimationFrame(() => titleRef.current?.focus())
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !saving) onClose?.()
      if (event.key !== 'Tab') return

      const focusable = dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')
      const items = Array.from(focusable || [])
      if (!items.length) return

      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open, saving])

  if (!open) return null

  function updateField(event) {
    const {name, value} = event.target
    setForm(current => ({...current, [name]: value}))
  }

  function closeIfIdle() {
    if (!saving) onClose?.()
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (form.title.trim().length < 3) {
      setError('Add a clear idea title.')
      return
    }

    if (form.description.trim().length < 5) {
      setError('Add enough description for the team to evaluate it.')
      return
    }

    setSaving(true)
    try {
      await onSubmit?.({
        ...form,
        title: form.title.trim(),
        description: form.description.trim(),
        why: form.why.trim(),
        suggested_owner: form.suggested_owner.trim(),
        tags: form.tags.trim()
      })
      setForm(initialForm)
    } catch (err) {
      setError(err?.message || 'Idea could not be submitted.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) closeIfIdle()
    }}>
      <section className="task-modal idea-modal" role="dialog" aria-modal="true" aria-labelledby="create-idea-title" ref={dialogRef}>
        <div className="section-title">
          <div>
            <p className="eyebrow">New signal</p>
            <h2 id="create-idea-title">Submit Idea</h2>
          </div>
          <Button variant="ghost" onClick={closeIfIdle} disabled={saving}>Close</Button>
        </div>
        <form className="task-form" onSubmit={handleSubmit}>
          <Field ref={titleRef} label="Title" name="title" value={form.title} onChange={updateField} placeholder="Name the opportunity" />
          <Field label="Description" name="description" value={form.description} onChange={updateField} placeholder="What should change, improve, or be explored?" multiline />
          <Field label="Why this matters" name="why" value={form.why} onChange={updateField} placeholder="Connect it to users, revenue, risk, speed, or quality" multiline />
          <div className="task-form-grid">
            <div className="field">
              <label className="field-label" htmlFor="idea-owner">Suggested owner</label>
              <input
                className="field-control"
                id="idea-owner"
                name="suggested_owner"
                value={form.suggested_owner}
                onChange={updateField}
                list="idea-owner-options"
                placeholder="Person or team"
              />
              <datalist id="idea-owner-options">
                {ownerOptions.map(user => (
                  <option key={user?.id || user?.name} value={user?.name || user?.username} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="idea-priority">Priority</label>
              <select className="field-control" id="idea-priority" name="priority" value={form.priority} onChange={updateField}>
                {IDEA_PRIORITIES.map(priority => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </div>
          </div>
          <Field label="Tags" name="tags" value={form.tags} onChange={updateField} placeholder="growth, onboarding, ops" />
          {error && <p className="field-error">{error}</p>}
          <div className="task-form-actions">
            <Button variant="secondary" onClick={closeIfIdle} disabled={saving}>Cancel</Button>
            <Button variant="primary" type="submit" loading={saving} disabled={saving}>Submit Idea</Button>
          </div>
        </form>
      </section>
    </div>
  )
}
