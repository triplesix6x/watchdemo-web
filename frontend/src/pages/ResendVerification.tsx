import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

export default function ResendVerification() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/auth/resend-verification', { email })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="page">
        <div className="card">
          <div className="alert alert-success">
            If that email exists and is unverified, a new link has been sent.
          </div>
          <Link to="/login" className="btn btn-ghost">Back to Login</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="card">
        <h1>Resend Verification</h1>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-full mt1" disabled={loading}>
            {loading ? 'Sending...' : 'Resend Verification Email'}
          </button>
        </form>
        <div className="links">
          <Link to="/login">Back to Login</Link>
        </div>
      </div>
    </div>
  )
}
