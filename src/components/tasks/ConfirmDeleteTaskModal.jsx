import {useEffect, useRef, useState} from 'react'
import Button from '../Button'

export default function ConfirmDeleteTaskModal({open, task, onClose, onConfirm}) {
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus())

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

  async function handleDelete() {
    setSaving(true)
    setError('')
    try {
      await onConfirm?.(task)
    } catch (err) {
      setError(err?.message || 'Task could not be deleted.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !saving) onClose?.()
    }}>
      <section className="task-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-task-title" ref={dialogRef}>
        <div className="section-title">
          <div>
            <p className="eyebrow">Delete task</p>
            <h2 id="delete-task-title">Delete this task?</h2>
          </div>
        </div>
        <p className="modal-copy">This action cannot be undone.</p>
        {task?.title && <p className="delete-task-name">{task.title}</p>}
        {error && <p className="field-error">{error}</p>}
        <div className="task-form-actions">
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="danger" loading={saving} disabled={saving} onClick={handleDelete}>Delete</Button>
        </div>
      </section>
    </div>
  )
}
