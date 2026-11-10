import type { AuthStatus } from './authStore.ts'

export const workspaceRoutes = ['dashboard', 'products', 'inventory', 'orders', 'settings'] as const
export function routeDecision(hash: string, status: AuthStatus) {
  const route = hash.replace(/^#\/?/, '')
  const publicRoute = route === 'login' || route === 'signup'
  if (status === 'checking' || status === 'error') return { view: status, redirect: null }
  if (status === 'anonymous') return { view: route === 'signup' ? 'signup' : 'login', redirect: publicRoute ? null : '#login' }
  return { view: 'application', redirect: workspaceRoutes.includes(route as typeof workspaceRoutes[number]) ? (hash === `#${route}` ? null : `#${route}`) : '#dashboard' }
}

export function oauthErrorMessage(search: string): string | null {
  const params = new URLSearchParams(search)
  if (!params.has('auth_error')) return null
  return params.get('auth_error') === 'account_conflict'
    ? 'An account already uses this email. Sign in with your existing method; Google accounts are not linked automatically.'
    : 'Google sign-in could not be completed. Please try again or use email and password.'
}
