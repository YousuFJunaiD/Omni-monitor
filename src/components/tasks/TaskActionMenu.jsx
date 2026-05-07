import {useEffect, useRef, useState} from 'react'
import {CheckCircle2, ExternalLink, MoreVertical, Pencil, Trash2} from 'lucide-react'
import IconButton from '../IconButton'

export default function TaskActionMenu({task, align = 'right', onOpenDetails, onEdit, onDelete, onMarkComplete}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const isDone = String(task?.status || '').toUpperCase() === 'DONE'

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setOpen(false)
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function run(action) {
    return event => {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      action?.(task)
    }
  }

  return (
    <div className={`task-action-menu task-action-menu-${align}`} ref={menuRef} onClick={event => event.stopPropagation()}>
      <IconButton
        className="task-action-trigger"
        label="Task actions"
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          setOpen(current => !current)
        }}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </IconButton>
      {open && (
        <div className="task-action-dropdown" role="menu">
          {onOpenDetails && (
            <button type="button" role="menuitem" onClick={run(onOpenDetails)}>
              <ExternalLink size={16} aria-hidden="true" />
              <span>Open details</span>
            </button>
          )}
          {onEdit && (
            <button type="button" role="menuitem" onClick={run(onEdit)}>
              <Pencil size={16} aria-hidden="true" />
              <span>Edit</span>
            </button>
          )}
          {onMarkComplete && (
            <button type="button" role="menuitem" onClick={run(onMarkComplete)} disabled={isDone}>
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>Mark complete</span>
            </button>
          )}
          {onDelete && (
            <button type="button" role="menuitem" className="danger" onClick={run(onDelete)}>
              <Trash2 size={16} aria-hidden="true" />
              <span>Delete</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
