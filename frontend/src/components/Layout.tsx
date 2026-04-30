import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  return (
    <>
      <nav>
        <Link to="/" className="brand">WatchDemo</Link>
        {user ? (
          <>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/sessions">Sessions</Link>
            {['support', 'moderator', 'admin'].includes(user.role) && <Link to="/admin">Admin</Link>}
            <span className="spacer" />
            <span className="nav-user">{user.username}</span>
            <button className="nav-btn" onClick={handleLogout}>Logout</button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <Link to="/login">Login</Link>
            <Link to="/register">Register</Link>
          </>
        )}
      </nav>
      {children}
    </>
  )
}
