import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AuthStore } from './authStore.ts'

export const AuthContext = createContext<AuthStore | null>(null)

export function useAuth() {
  const store = useContext(AuthContext)
  if (!store) throw new Error('Authentication provider is missing')
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { ...state, restore: store.restore, login: store.login, register: store.register, logout: store.logout }
}
