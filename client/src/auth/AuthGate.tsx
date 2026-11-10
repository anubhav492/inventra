import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Boxes, LoaderCircle } from 'lucide-react'
import { useAuth } from './authContext.ts'
import { oauthErrorMessage, routeDecision } from './authRouting.ts'
import AuthPage from '../pages/AuthPage.tsx'
import '../styles/auth.css'

export default function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const [hash, setHash] = useState(() => typeof location === 'undefined' ? '' : location.hash)
  const [oauthError, setOauthError] = useState(() => oauthErrorMessage(typeof location === 'undefined' ? '' : location.search ?? ''))
  const decision = routeDecision(hash, auth.status)
  useEffect(() => {
    const update = () => setHash(location.hash)
    window.addEventListener('hashchange', update)
    const url = new URL(location.href)
    if (url.searchParams.has('auth_error')) {
      url.searchParams.delete('auth_error')
      history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => {
    if (!decision.redirect) return
    history.replaceState(null, '', location.pathname + location.search + decision.redirect)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [decision.redirect])

  if (decision.view === 'checking') return <main className="auth-screen"><div className="auth-status" role="status"><LoaderCircle className="auth-spinner" size={26} /><p>Checking your session…</p></div></main>
  if (decision.view === 'error') return <main className="auth-screen"><section className="panel auth-card"><span className="brand auth-brand"><span className="brand-icon"><Boxes size={24} /></span>Inventra</span><h1>Unable to check your session</h1><p className="auth-description">Your workspace stays closed until we can verify your session.</p><p role="alert" className="auth-error">{auth.error}</p><button className="primary-button auth-wide" onClick={() => void auth.restore()}>Try again</button></section></main>
  if (decision.view === 'login' || decision.view === 'signup') return <AuthPage key={decision.view} mode={decision.view} oauthError={oauthError} onDismissOAuthError={() => setOauthError(null)} />
  return <>{oauthError && <div className="auth-oauth-notice" role="alert"><span>{oauthError}</span><button type="button" onClick={() => setOauthError(null)} aria-label="Dismiss Google sign-in error">Dismiss</button></div>}{children}</>
}
