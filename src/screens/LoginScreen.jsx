import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Button from '../components/Button'
import Field from '../components/Field'
import { useAuth } from '../context/AuthContext'

export default function LoginScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()

  const from = location.state?.from?.pathname || '/home'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!username.trim()) {
      setError('Username is required')
      return
    }

    if (!password.trim()) {
      setError('Password is required')
      return
    }

    setLoading(true)

    try {
      await login(username.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err?.message || 'Invalid username or password')
      setLoading(false)
    }
  }

  const handleUsernameChange = (e) => {
    setUsername(e.target.value)
    if (error) setError('')
  }

  const handlePasswordChange = (e) => {
    setPassword(e.target.value)
    if (error) setError('')
  }

  const isButtonDisabled = loading || !username.trim() || !password.trim()

  return (
    <main className="login-screen">
      <section className="placeholder-card login-card">
        <p className="eyebrow">Team operations</p>
        <h1>Omnimate Monitor</h1>
        <p className="muted">Sign in to review priority work, ideas, and team signals.</p>
        <form onSubmit={handleSubmit}>
          <Field
            label="Username"
            autoComplete="username"
            value={username}
            onChange={handleUsernameChange}
            disabled={loading}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={handlePasswordChange}
            disabled={loading}
          />
          {error && <p className="field-error">{error}</p>}
          <Button
            variant="primary"
            type="submit"
            disabled={isButtonDisabled}
            loading={loading}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </section>
    </main>
  )
}
