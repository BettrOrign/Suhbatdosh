import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, setToken } from '@/lib/api'
import type { User } from '@/lib/types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (data: { org_name: string; name: string; email: string; password: string }) => Promise<void>
  acceptInvite: (token: string, data: { name: string; password: string }) => Promise<void>
  refreshUser: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.me()
      setUser(me)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    setToken(null)
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handler = () => {
      setUser(null)
    }
    window.addEventListener('auth:logout', handler)
    return () => window.removeEventListener('auth:logout', handler)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password)
    setUser(res.user)
  }, [])

  const signup = useCallback(
    async (data: { org_name: string; name: string; email: string; password: string }) => {
      const res = await api.signup(data)
      setUser(res.user)
    },
    [],
  )

  const acceptInvite = useCallback(
    async (token: string, data: { name: string; password: string }) => {
      const res = await api.acceptInvite(token, data)
      setUser(res.user)
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* ignore */
    }
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, loading, login, signup, acceptInvite, refreshUser, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
