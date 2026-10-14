import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type User } from './api'

type AuthState = {
  user: User | null
  loading: boolean
  setUser: (user: User | null) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // On page load, ask the API who we are. The session lives in an httpOnly cookie,
  // so JavaScript can't read it directly.
  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  async function logout() {
    await api.logout()
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, setUser, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
