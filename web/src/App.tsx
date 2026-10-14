import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api } from './api'
import { useAuth } from './auth'
import Checkout from './pages/Checkout'
import EventPage from './pages/EventPage'
import EventsPage from './pages/EventsPage'
import LoginPage from './pages/LoginPage'
import MyTickets from './pages/MyTickets'
import NewEvent from './pages/NewEvent'
import OrganizerPage from './pages/OrganizerPage'
import RegisterPage from './pages/RegisterPage'

function RequireAuth({ children, organizer = false }: { children: ReactNode; organizer?: boolean }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  if (organizer && user.role !== 'organizer') return <Navigate to="/" replace />
  return children
}

function Header() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="wordmark">
          Stagepass
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Events
          </NavLink>
          {user && <NavLink to="/tickets">My tickets</NavLink>}
          {user?.role === 'organizer' && <NavLink to="/organizer">Organizer</NavLink>}
          {user ? (
            <button
              className="link-button"
              onClick={async () => {
                await logout()
                navigate('/')
              }}
            >
              Log out
            </button>
          ) : (
            <NavLink to="/login">Log in</NavLink>
          )}
        </nav>
      </div>
    </header>
  )
}

// Shows which server answered. Behind a load balancer this changes as you click around.
function Footer() {
  const { pathname } = useLocation()
  const [server, setServer] = useState('')

  useEffect(() => {
    api
      .health()
      .then((res) => setServer(res.server))
      .catch(() => setServer(''))
  }, [pathname])

  if (!server) return null
  return (
    <footer className="site-footer">
      Served by <code>{server}</code>
    </footer>
  )
}

export default function App() {
  return (
    <>
      <Header />
      <main className="page">
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/events/:id" element={<EventPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/checkout/:bookingId"
            element={
              <RequireAuth>
                <Checkout />
              </RequireAuth>
            }
          />
          <Route
            path="/tickets"
            element={
              <RequireAuth>
                <MyTickets />
              </RequireAuth>
            }
          />
          <Route
            path="/organizer"
            element={
              <RequireAuth organizer>
                <OrganizerPage />
              </RequireAuth>
            }
          />
          <Route
            path="/organizer/new"
            element={
              <RequireAuth organizer>
                <NewEvent />
              </RequireAuth>
            }
          />
          <Route path="*" element={<p className="empty">This page doesn't exist. <Link to="/">See all events</Link></p>} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
