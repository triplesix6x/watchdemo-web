import { useState, type FormEvent } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api/client'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const token = params.get('token')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!token) { setError('Missing reset token.'); return }
    setError('')
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: newPassword })
      navigate('/login', { state: { message: 'Password reset. Please log in.' } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="page">
        <div className="card">
          <div className="alert alert-error">Invalid reset link — no token found.</div>
          <Link to="/forgot-password" className="btn btn-ghost">Request new link</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="card">
        <h1>Reset Password</h1>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="new_password">New Password</label>
            <input
              id="new_password"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
            <span className="text-sm">Min 10 chars, 1 uppercase, 1 digit</span>
          </div>
          <button type="submit" className="btn btn-primary btn-full mt1" disabled={loading}>
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
