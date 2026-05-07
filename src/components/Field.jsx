import {forwardRef, useId} from 'react'

const Field = forwardRef(function Field({error, label, multiline = false, ...props}, ref) {
  const id = useId()
  const describedBy = error ? `${id}-error` : undefined
  const Input = multiline ? 'textarea' : 'input'
  const safeLabel = label || 'Field'

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{safeLabel}</label>
      <Input
        className="field-control"
        id={id}
        ref={ref}
        aria-describedby={describedBy}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      />
      {error && <p className="field-error" id={describedBy}>{error}</p>}
    </div>
  )
})

export default Field
