function Card() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <span className="skeleton skeleton-title" />
      <span className="skeleton skeleton-line" />
      <span className="skeleton skeleton-line skeleton-short" />
    </div>
  )
}

function List({rows = 3}) {
  const rowCount = Number.isFinite(Number(rows)) ? Math.max(0, Number(rows)) : 3

  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({length: rowCount}).map((_, index) => (
        <span className="skeleton skeleton-row" key={index} />
      ))}
    </div>
  )
}

function Stat() {
  return (
    <div className="skeleton-stat" aria-hidden="true">
      <span className="skeleton skeleton-number" />
      <span className="skeleton skeleton-line" />
    </div>
  )
}

export default {Card, List, Stat}
export {Card, List, Stat}
