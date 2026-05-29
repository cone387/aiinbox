import { create } from 'zustand'
import * as authApi from '../api/auth'

interface AuthState {
  isAuthenticated: boolean
  loading: boolean
  error: string | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => void
  checkAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: authApi.isAuthenticated(),
  loading: false,
  error: null,

  login: async (username, password) => {
    set({ loading: true, error: null })
    try {
      await authApi.login(username, password)
      set({ isAuthenticated: true, loading: false })
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '登录失败'
      set({ error: message, loading: false })
    }
  },

  register: async (username, password) => {
    set({ loading: true, error: null })
    try {
      await authApi.register(username, password)
      set({ loading: false })
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '注册失败'
      set({ error: message, loading: false })
    }
  },

  logout: () => {
    authApi.logout()
    set({ isAuthenticated: false })
  },

  checkAuth: () => {
    set({ isAuthenticated: authApi.isAuthenticated() })
  },
}))
