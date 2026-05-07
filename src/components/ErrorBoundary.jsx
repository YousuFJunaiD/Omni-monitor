import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error) {
    if (import.meta.env.DEV && typeof window !== 'undefined' && typeof window.reportError === 'function') {
      window.reportError(error)
    }
  }

  render() {
    if (this.state.hasError) {
      const message = String(this.state.error?.message || '')
      const isChunkError = /chunk|dynamic import|loading css/i.test(message)
      return (
        <main className="login-screen">
          <section className="placeholder-card login-card">
            <p className="eyebrow">{isChunkError ? 'Update ready' : 'Application error'}</p>
            <h1>{isChunkError ? 'Refresh to finish loading' : 'Something went wrong'}</h1>
            <p className="muted">
              {isChunkError
                ? 'A new version of the app is available or a route chunk failed to load. Refreshing will restore the session.'
                : 'The app hit an unexpected runtime issue. Refresh the page to restore a stable session.'}
            </p>
            <div className="error-actions">
              <button
                className="btn btn-primary"
                onClick={() => window.location.reload()}
                type="button"
              >
                Refresh Page
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => this.setState({hasError: false, error: null})}
                type="button"
              >
                Try Again
              </button>
            </div>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
