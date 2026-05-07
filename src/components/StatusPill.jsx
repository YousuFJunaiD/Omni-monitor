const variantClass = {
  pending: 'status-pending',
  approved: 'status-approved',
  rejected: 'status-rejected',
  progress: 'status-progress'
}

export default function StatusPill({children, variant = 'pending'}) {
  const safeVariant = typeof variant === 'string' ? variant : 'pending'
  const label = children ?? 'Pending'
  return <span className={`status-pill ${variantClass[safeVariant] || variantClass.pending}`}>{label}</span>
}
