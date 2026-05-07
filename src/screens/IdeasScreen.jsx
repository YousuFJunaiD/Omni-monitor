import IdeaCard from '../components/IdeaCard'
import Badge from '../components/Badge'
import ScreenLoader from '../components/ScreenLoader'
import {useDashboardContext} from '../context/DashboardContext'

export default function IdeasScreen() {
  const {ideas, loading, error, refresh} = useDashboardContext()
  const safeIdeas = Array.isArray(ideas) ? ideas : []
  const trendingIdeas = [...safeIdeas]
    .sort((a, b) => Number(b?.votes || b?.vote_count || b?.score || 0) - Number(a?.votes || a?.vote_count || a?.score || 0))
    .slice(0, 3)

  return (
    <>
      <header className="screen-header">
        <div className="top">
          <div>
            <p className="eyebrow">Idea board</p>
            <h1>Innovation board</h1>
            <p className="muted">Vote on promising ideas, discuss tradeoffs, and keep experiments visible before they become work.</p>
          </div>
        </div>
      </header>
      <ScreenLoader
        loading={loading}
        error={error}
        isEmpty={safeIdeas.length === 0}
        emptyTitle="Start the first product conversation."
        emptyDescription="Capture one opportunity, assign an owner, and use votes or comments to decide whether it deserves execution time."
        onRetry={refresh}
      >
        <div className="ideas-layout">
          <section className="panel ideas-spotlight">
            <div className="section-title">
              <h2>Trending now</h2>
              <Badge>{trendingIdeas.length} signals</Badge>
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
              <h2>Team ideas</h2>
              <Badge>{safeIdeas.length} open</Badge>
            </div>
            <div className="idea-grid">
              {safeIdeas.map((idea, index) => (
                <IdeaCard key={idea?.id ?? idea?.title ?? index} idea={idea} />
              ))}
            </div>
          </section>
        </div>
      </ScreenLoader>
    </>
  )
}
