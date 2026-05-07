import {forwardRef} from 'react'

const Button = forwardRef(function Button({children, className = '', loading = false, variant = 'ghost', type = 'button', ...props}, ref) {
  return (
    <button
      aria-busy={loading || undefined}
      className={`btn btn-${variant} ${className}`.trim()}
      data-loading={loading || undefined}
      ref={ref}
      type={type}
      {...props}
    >
      {children}
    </button>
  )
})

export default Button
