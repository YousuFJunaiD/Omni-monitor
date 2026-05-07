export default function EmptyState({action, description, title}) {
  const safeTitle = title || 'No data available'

  return (
    <section className="empty-state" aria-label={safeTitle}>
      <h2>{safeTitle}</h2>
      {description && <p>{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </section>
  )
}
