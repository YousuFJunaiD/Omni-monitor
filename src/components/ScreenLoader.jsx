import { memo } from 'react'
import Skeleton from './Skeleton'
import EmptyState from './EmptyState'

const ScreenLoader = memo(function ScreenLoader({ loading, error, isEmpty, emptyTitle, emptyDescription, emptyAction, onRetry, children }) {
  if (loading) {
    return <Skeleton.Card />
  }

  if (error) {
    const message = typeof error === 'string' ? error : error?.message || 'No data available'
    return (
      <section className="panel">
        <EmptyState title="Content unavailable" description={message} />
        {onRetry && (
          <div className="empty-state-action">
            <button className="btn btn-secondary" type="button" onClick={onRetry}>Retry</button>
          </div>
        )}
      </section>
    )
  }

  if (isEmpty) {
    return (
      <section className="panel">
        <EmptyState
          title={emptyTitle || 'No content yet'}
          description={emptyDescription || 'Get started by creating your first item.'}
          action={emptyAction}
        />
      </section>
    )
  }

  return children
})

export default ScreenLoader
