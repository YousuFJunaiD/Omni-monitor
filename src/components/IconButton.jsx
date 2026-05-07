export default function IconButton({children, className = '', label, type = 'button', ...props}) {
  if (!label) {
    throw new Error('IconButton requires a label prop')
  }

  return (
    <button className={`icon-btn ${className}`.trim()} type={type} aria-label={label} {...props}>
      {children}
    </button>
  )
}
