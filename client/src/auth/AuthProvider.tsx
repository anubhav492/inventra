import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './authContext.ts'
import { createAuthStore } from './authStore.ts'
import type { AuthStore } from './authStore.ts'

export default function AuthProvider({ children, store: suppliedStore }: { children: ReactNode; store?: AuthStore }) {
  const [store] = useState(() => suppliedStore ?? createAuthStore())
  useEffect(() => { void store.restore() }, [store])
  return <AuthContext.Provider value={store}>{children}</AuthContext.Provider>
}
