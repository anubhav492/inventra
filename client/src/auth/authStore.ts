import { api, ApiError, API_BASE_URL } from '../services/api.ts'

export interface AuthUser { id: string; name: string; email: string }
export interface Credentials { email: string; password: string }
export interface Registration extends Credentials { name: string }
export type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'error'
export interface AuthState { status: AuthStatus; user: AuthUser | null; pending: boolean; error: string | null }
export type AuthClient = Pick<typeof api, 'get' | 'post'>

export const GOOGLE_SIGN_IN_URL = new URL('api/auth/google', `${API_BASE_URL.replace(/\/$/, '')}/`).href

export function authErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'
}

function userFromResponse(response: unknown): AuthUser {
  if (response && typeof response === 'object' && 'success' in response && response.success === true && 'data' in response) {
    const user = response.data
    if (user && typeof user === 'object' && 'id' in user && 'name' in user && 'email' in user
      && typeof user.id === 'string' && user.id && typeof user.name === 'string' && typeof user.email === 'string') {
      return { id: user.id, name: user.name, email: user.email }
    }
  }
  throw new ApiError('parse', 'The server returned an invalid account response. Please try again.')
}

/** In-memory only. No credentials, user records or session identifiers are persisted. */
export function createAuthStore(client: AuthClient = api) {
  let state: AuthState = { status: 'checking', user: null, pending: false, error: null }
  const listeners = new Set<() => void>()
  let revision = 0
  let restoring: Promise<void> | undefined
  function update(next: AuthState) { state = next; listeners.forEach(listener => listener()) }
  function unauthorized(error: unknown) { return error instanceof ApiError && error.status === 401 }

  async function restore() {
    if (restoring) return restoring
    const current = ++revision
    update({ status: 'checking', user: null, pending: false, error: null })
    restoring = (async () => {
      try {
        const user = userFromResponse(await client.get('/api/auth/me'))
        if (current === revision) update({ status: 'authenticated', user, pending: false, error: null })
      } catch (error) {
        if (current !== revision) return
        update({ status: unauthorized(error) ? 'anonymous' : 'error', user: null, pending: false, error: unauthorized(error) ? null : authErrorMessage(error) })
      } finally { restoring = undefined }
    })()
    return restoring
  }

  async function authenticate(path: string, credentials: Credentials | Registration) {
    if (state.pending) throw new Error('Authentication request already in progress')
    const current = ++revision
    update({ ...state, pending: true, error: null })
    try {
      const user = userFromResponse(await client.post(path, { ...credentials }))
      if (current === revision) update({ status: 'authenticated', user, pending: false, error: null })
    } catch (error) {
      if (current === revision) update({ ...state, pending: false, error: authErrorMessage(error) })
      throw error
    }
  }

  async function logout() {
    if (state.pending) throw new Error('Authentication request already in progress')
    const current = ++revision
    update({ ...state, pending: true, error: null })
    try {
      await client.post('/api/auth/logout', {})
      if (current === revision) update({ status: 'anonymous', user: null, pending: false, error: null })
    } catch (error) {
      if (current === revision) update(unauthorized(error)
        ? { status: 'anonymous', user: null, pending: false, error: null }
        : { ...state, pending: false, error: authErrorMessage(error) })
      if (!unauthorized(error)) throw error
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    restore, login: (credentials: Credentials) => authenticate('/api/auth/login', credentials),
    register: (credentials: Registration) => authenticate('/api/auth/register', credentials), logout,
  }
}

export type AuthStore = ReturnType<typeof createAuthStore>

export interface AuthFormValues extends Registration { confirmPassword: string }
export function validateAuthForm(mode: 'login' | 'signup', values: AuthFormValues) {
  const errors: Partial<Record<keyof AuthFormValues, string>> = {}
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()) || values.email.trim().length > 254) errors.email = 'Enter a valid email address.'
  if (!values.password || (mode === 'signup' && values.password.length < 12)) errors.password = mode === 'signup' ? 'Use at least 12 characters.' : 'Enter your password.'
  if (new TextEncoder().encode(values.password).length > 1024) errors.password = 'Password must be at most 1024 bytes.'
  if (mode === 'signup') {
    if (!values.name.trim() || values.name.trim().length > 150) errors.name = 'Enter a name of 1 to 150 characters.'
    if (values.confirmPassword !== values.password) errors.confirmPassword = 'Passwords do not match.'
  }
  return errors
}
