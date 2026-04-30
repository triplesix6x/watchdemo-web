import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Home() {
  const { user, isLoading } = useAuth()

  return (
    <div className="page" style={{ marginTop: '5rem' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>WatchDemo</h1>
        <p className="text-sm" style={{ marginBottom: '2rem' }}>Subscription management demo</p>
        {isLoading ? (
          <p className="text-sm">Loading...</p>
        ) : user ? (
          <div>
            <p className="text-sm" style={{ marginBottom: '1rem' }}>
              Logged in as <strong>{user.username}</strong>
            </p>
            <Link to="/dashboard" className="btn btn-primary">Go to Dashboard</Link>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to="/login" className="btn btn-primary">Login</Link>
            <Link to="/register" className="btn btn-ghost">Register</Link>
          </div>
        )}
      </div>
    </div>
  )
}
