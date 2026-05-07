import {useEffect, useRef, useState} from 'react'
import Button from '../Button'
import Field from '../Field'
import {TASK_PRIORITIES} from '../../services/taskService'

function dateInputValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function formFromTask(task) {
  return {
    title: task?.title || '',
    details: task?.details ?? task?.description ?? '',
    priority: task?.priority || 'MEDIUM',
    due_date: dateInputValue(task?.due_date || task?.dueDate)
  }
}

export default function EditTaskModal({open, task, onClose, onSubmit}) {
  const dialogRef = useRef(null)
  const titleRef = useRef(null)
  const [form, setForm] = useState(() => formFromTask(task))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) setForm(formFromTask(task))
    setError('')
  }, [open, task])

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

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!form.title.trim()) {
      setError('Add a task title.')
      return
    }

    setSaving(true)
    try {
      await onSubmit?.(task?.id, {
        title: form.title.trim(),
        details: form.details.trim(),
        priority: form.priority,
        due_date: form.due_date
      })
    } catch (err) {
      setError(err?.message || 'Task could not be updated.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !saving) onClose?.()
    }}>
      <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="edit-task-title" ref={dialogRef}>
        <div className="section-title">
          <div>
            <p className="eyebrow">Edit task</p>
            <h2 id="edit-task-title">Edit Task</h2>
          </div>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Close</Button>
        </div>
        <form className="task-form" onSubmit={handleSubmit}>
          <Field ref={titleRef} label="Title" name="title" value={form.title} onChange={updateField} placeholder="Define the outcome" />
          <Field label="Description" name="details" value={form.details} onChange={updateField} placeholder="Add context, links, acceptance notes" multiline />
          <div className="task-form-grid">
            <div className="field">
              <label className="field-label" htmlFor="edit-task-priority">Priority</label>
              <select className="field-control" id="edit-task-priority" name="priority" value={form.priority} onChange={updateField}>
                {TASK_PRIORITIES.map(priority => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </div>
            <Field label="Due date" name="due_date" type="date" value={form.due_date} onChange={updateField} />
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="task-form-actions">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" type="submit" loading={saving} disabled={saving}>Save changes</Button>
          </div>
        </form>
      </section>
    </div>
  )
}
