import {useEffect, useMemo, useRef, useState} from 'react'
import Button from '../Button'
import Field from '../Field'
import {TASK_PRIORITIES} from '../../services/taskService'

const initialForm = {
  title: '',
  details: '',
  assigned_to: '',
  priority: 'MEDIUM',
  due_date: ''
}

export default function CreateTaskModal({open, users = [], onClose, onSubmit}) {
  const dialogRef = useRef(null)
  const titleRef = useRef(null)
  const assignableUsers = useMemo(() => (
    Array.isArray(users) ? users.filter(user => user?.id) : []
  ), [users])
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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

  const selectedAssignee = form.assigned_to || assignableUsers[0]?.id || ''
  const closeIfIdle = () => {
    if (!saving) onClose?.()
  }

  function updateField(event) {
    const {name, value} = event.target
    setForm(current => ({...current, [name]: value}))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!form.title.trim()) {
      setError('Add a task title.')
      return
    }

    if (!selectedAssignee) {
      setError('Choose an assignee.')
      return
    }

    setSaving(true)
    try {
      await onSubmit?.({
        ...form,
        assigned_to: selectedAssignee,
        title: form.title.trim(),
        details: form.details.trim()
      })
      setForm(initialForm)
    } catch (err) {
      setError(err?.message || 'Task could not be created.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) closeIfIdle()
    }}>
      <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="create-task-title" ref={dialogRef}>
        <div className="section-title">
          <div>
            <p className="eyebrow">New task</p>
            <h2 id="create-task-title">Create Task</h2>
          </div>
          <Button variant="ghost" onClick={closeIfIdle} disabled={saving}>Close</Button>
        </div>
        <form className="task-form" onSubmit={handleSubmit}>
          <Field ref={titleRef} label="Title" name="title" value={form.title} onChange={updateField} placeholder="Define the outcome" />
          <Field label="Description" name="details" value={form.details} onChange={updateField} placeholder="Add context, links, acceptance notes" multiline />
          <div className="task-form-grid">
            <div className="field">
              <label className="field-label" htmlFor="task-assignee">Assignee</label>
              <select className="field-control" id="task-assignee" name="assigned_to" value={selectedAssignee} onChange={updateField}>
                {assignableUsers.map(user => (
                  <option key={user.id} value={user.id}>{user.name || user.username || 'Team member'}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="task-priority">Priority</label>
              <select className="field-control" id="task-priority" name="priority" value={form.priority} onChange={updateField}>
                {TASK_PRIORITIES.map(priority => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </div>
          </div>
          <Field label="Due date" name="due_date" type="date" value={form.due_date} onChange={updateField} />
          {error && <p className="field-error">{error}</p>}
          <div className="task-form-actions">
            <Button variant="secondary" onClick={closeIfIdle} disabled={saving}>Cancel</Button>
            <Button variant="primary" type="submit" loading={saving} disabled={saving}>Create Task</Button>
          </div>
        </form>
      </section>
    </div>
  )
}
