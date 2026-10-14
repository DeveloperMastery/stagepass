import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'

export default function LoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const next = useSearchParams()[0].get('next') ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await api.login(email, password)
      setUser(res.user)
      navigate(next.startsWith('/') ? next : '/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in')
      setSubmitting(false)
    }
  }

  return (
    <form className="form narrow" onSubmit={submit}>
      <h1 className="page-title">Log in</h1>
      <label>
        Email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="button button--primary button--block" disabled={submitting}>
        {submitting ? 'Logging in...' : 'Log in'}
      </button>
      <p className="muted">
        New here? <Link to={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link>
      </p>
      <p className="muted small">
        Demo accounts: customer@stagepass.dev / customer123, organizer@stagepass.dev / organizer123
      </p>
    </form>
  )
}
