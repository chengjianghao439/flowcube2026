import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  login: (token: string, user: User) => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      login: (token, user) => {
        set({ token, user, isAuthenticated: true })
      },

      logout: () => {
        try {
          localStorage.removeItem('flowcube-auth')
        } catch {
          /* ignore */
        }
        set({ token: null, user: null, isAuthenticated: false })
      },

      updateUser: (partial) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        }))
      },
    }),
    {
      name: 'flowcube-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
      onRehydrateStorage: () => (state) => {
        if (state?.token) {
          state.isAuthenticated = true
        }
      },
    },
  ),
)
