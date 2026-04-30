import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { api } from '../api/client'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setStatus('error')
      setMessage('No verification token in URL.')
      return
    }
    api.get<{ message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(data => {
        setMessage(data.message ?? 'Email verified successfully.')
        setStatus('success')
      })
      .catch(err => {
        setMessage(err instanceof Error ? err.message : 'Verification failed.')
        setStatus('error')
      })
  }, [params])

  return (
    <div className="page">
      <div className="card">
        <h1>Email Verification</h1>
        {status === 'loading' && <p className="text-sm">Verifying...</p>}
        {status === 'success' && (
          <>
            <div className="alert alert-success">{message}</div>
            <Link to="/login" className="btn btn-primary">Login</Link>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="alert alert-error">{message}</div>
            <Link to="/resend-verification" className="btn btn-ghost">Resend verification email</Link>
          </>
        )}
      </div>
    </div>
  )
}
