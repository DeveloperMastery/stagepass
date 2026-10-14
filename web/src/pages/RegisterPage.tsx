import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Role } from '../api'
import { useAuth } from '../auth'

export default function RegisterPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const next = useSearchParams()[0].get('next') ?? '/'
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'customer' as Role })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await api.register(form)
      setUser(res.user)
      navigate(form.role === 'organizer' ? '/organizer' : next.startsWith('/') ? next : '/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account')
      setSubmitting(false)
    }
  }

  return (
    <form className="form narrow" onSubmit={submit}>
      <h1 className="page-title">Create an account</h1>
      <label>
        Name
        <input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label>
        Email
        <input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <span className="muted small">At least 8 characters</span>
      </label>
      <fieldset className="radio-group">
        <legend>I want to</legend>
        <label>
          <input type="radio" name="role" checked={form.role === 'customer'} onChange={() => setForm({ ...form, role: 'customer' })} />
          Buy tickets
        </label>
        <label>
          <input type="radio" name="role" checked={form.role === 'organizer'} onChange={() => setForm({ ...form, role: 'organizer' })} />
          Sell tickets for my events
        </label>
      </fieldset>
      {error && <p className="error">{error}</p>}
      <button className="button button--primary button--block" disabled={submitting}>
        {submitting ? 'Creating account...' : 'Create account'}
      </button>
      <p className="muted">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </form>
  )
}
