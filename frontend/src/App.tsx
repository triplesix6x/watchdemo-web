import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import VerifyEmail from './pages/VerifyEmail'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import ResendVerification from './pages/ResendVerification'
import Dashboard from './pages/Dashboard'
import Sessions from './pages/Sessions'
import Admin from './pages/Admin'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/resend-verification" element={<ResendVerification />} />
            <Route
              path="/dashboard"
              element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
            />
            <Route
              path="/sessions"
              element={<ProtectedRoute><Sessions /></ProtectedRoute>}
            />
            <Route
              path="/admin"
              element={<ProtectedRoute allowedRoles={['support', 'moderator', 'admin']}><Admin /></ProtectedRoute>}
            />
          </Routes>
        </Layout>
      </AuthProvider>
    </BrowserRouter>
  )
}
