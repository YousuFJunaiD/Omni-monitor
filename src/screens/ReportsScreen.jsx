import ScreenLoader from '../components/ScreenLoader'

export default function ReportsScreen() {
  return (
    <>
      <header className="screen-header">
        <p className="eyebrow">Executive</p>
        <h1>Reports</h1>
        <p className="muted">A focused reporting surface for progress, risk, and leadership decisions.</p>
      </header>
      <ScreenLoader
        loading={false}
        error=""
        isEmpty={true}
        emptyTitle="Reports are not ready to generate yet."
        emptyDescription="When reporting is enabled, this view will summarize progress and risk in a decision-ready format."
      />
    </>
  )
}
