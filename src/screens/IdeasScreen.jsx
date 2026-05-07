import {Suspense, lazy, useCallback, useMemo, useState} from 'react'
import {Plus} from 'lucide-react'
import IdeaCard from '../components/IdeaCard'
import Badge from '../components/Badge'
import Button from '../components/Button'
import ScreenLoader from '../components/ScreenLoader'
import {useDashboardContext} from '../context/DashboardContext'
import {useNotify} from '../lib/notify'

const CreateIdeaModal = lazy(() => import('../components/CreateIdeaModal'))

export default function IdeasScreen() {
  const {showToast} = useNotify()
  const {ideas, visibleUsers, loading, error, refresh, createIdea} = useDashboardContext()
  const [createOpen, setCreateOpen] = useState(false)
  const safeIdeas = Array.isArray(ideas) ? ideas : []
  const pendingCount = safeIdeas.filter(idea => String(idea?.status || '').toUpperCase() === 'PENDING').length
  const inMotionCount = safeIdeas.filter(idea => ['UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS'].includes(String(idea?.status || '').toUpperCase())).length
  const trendingIdeas = useMemo(() => [...safeIdeas]
    .sort((a, b) => Number(b?.votes || b?.vote_count || b?.score || 0) - Number(a?.votes || a?.vote_count || a?.score || 0))
    .slice(0, 3), [safeIdeas])

  const handleSubmitIdea = useCallback(async input => {
    try {
      await createIdea(input)
      setCreateOpen(false)
      showToast({type: 'success', message: 'Idea submitted'})
    } catch (err) {
      showToast({type: 'error', message: err?.message || 'Idea could not be submitted'})
      throw err
    }
  }, [createIdea, showToast])

  return (
    <>
      <header className="screen-header">
        <div className="top">
          <div>
            <p className="eyebrow">Idea board</p>
            <h1>Innovation board</h1>
            <p className="muted">Capture product opportunities, evaluate tradeoffs, and keep emerging bets visible before they become work.</p>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={17} />
            Submit Idea
          </Button>
        </div>
      </header>
      <ScreenLoader
        loading={loading}
        error={error}
        isEmpty={safeIdeas.length === 0}
        emptyTitle="Start the first product conversation."
        emptyDescription="Capture one opportunity, assign an owner, and use the board to decide whether it deserves execution time."
        emptyAction={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={17} />Submit Idea</Button>}
        onRetry={refresh}
      >
        <div className="ideas-layout">
          <section className="panel ideas-spotlight">
            <div className="section-title">
              <div>
                <h2>Signal health</h2>
                <p className="muted">How the idea backlog is moving through evaluation.</p>
              </div>
              <Badge>{safeIdeas.length} total</Badge>
            </div>
            <div className="idea-health-grid">
              <div>
                <strong>{pendingCount}</strong>
                <span>Pending review</span>
              </div>
              <div>
                <strong>{inMotionCount}</strong>
                <span>In motion</span>
              </div>
              <div>
                <strong>{trendingIdeas.length}</strong>
                <span>Top signals</span>
              </div>
            </div>
            <div className="trending-ideas">
              {trendingIdeas.map((idea, index) => (
                <article key={idea?.id || idea?.title || index}>
                  <span>{index + 1}</span>
                  <div>
                    <h3>{idea?.title || idea?.name || 'Untitled idea'}</h3>
                    <p className="muted">{idea?.summary || idea?.description || 'Open for discussion.'}</p>
                  </div>
                  <Badge>{Number(idea?.votes || idea?.vote_count || idea?.score || 0)} votes</Badge>
                </article>
              ))}
            </div>
          </section>
          <section className="panel ideas-board">
            <div className="section-title">
              <div>
                <h2>Team ideas</h2>
                <p className="muted">Newest opportunities with ownership, status, and signal metadata.</p>
              </div>
              <Badge>{safeIdeas.length} visible</Badge>
            </div>
            <div className="idea-grid">
              {safeIdeas.map((idea, index) => (
                <IdeaCard key={idea?.id ?? idea?.title ?? index} idea={idea} />
              ))}
            </div>
          </section>
        </div>
      </ScreenLoader>
      <Suspense fallback={null}>
        {createOpen && (
          <CreateIdeaModal
            open
            users={visibleUsers}
            onClose={() => setCreateOpen(false)}
            onSubmit={handleSubmitIdea}
          />
        )}
      </Suspense>
    </>
  )
}
