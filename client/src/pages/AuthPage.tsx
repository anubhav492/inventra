import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Boxes, LoaderCircle } from 'lucide-react'
import { useAuth } from '../auth/authContext.ts'
import { authErrorMessage, GOOGLE_SIGN_IN_URL, validateAuthForm } from '../auth/authStore.ts'
import type { AuthFormValues } from '../auth/authStore.ts'

export default function AuthPage({ mode, oauthError, onDismissOAuthError }: { mode: 'login' | 'signup'; oauthError: string | null; onDismissOAuthError: () => void }) {
  const auth = useAuth()
  const signup = mode === 'signup'
  const [values, setValues] = useState<AuthFormValues>({ name: '', email: '', password: '', confirmPassword: '' })
  const [errors, setErrors] = useState<Partial<Record<keyof AuthFormValues, string>>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const locked = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const busy = auth.pending || redirecting

  function change(field: keyof AuthFormValues, value: string) {
    setValues(previous => ({ ...previous, [field]: value }))
    setErrors(previous => ({ ...previous, [field]: undefined }))
    setFailure(null)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked.current || busy) return
    const validation = validateAuthForm(mode, values)
    setErrors(validation)
    if (Object.keys(validation).length) { requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()); return }
    locked.current = true
    setFailure(null)
    onDismissOAuthError()
    try {
      const credentials = { email: values.email.trim(), password: values.password }
      if (signup) await auth.register({ ...credentials, name: values.name.trim() })
      else await auth.login(credentials)
    } catch (error) { setFailure(authErrorMessage(error)) }
    finally { locked.current = false; setValues(previous => ({ ...previous, password: '', confirmPassword: '' })) }
  }
  function google() {
    if (busy || locked.current) return
    locked.current = true
    setRedirecting(true)
    setFailure(null)
    try { window.location.assign(GOOGLE_SIGN_IN_URL) }
    catch { locked.current = false; setRedirecting(false); setFailure('Unable to open Google sign-in. Please try again.') }
  }
  function field(name: keyof AuthFormValues, label: string, type: string, autoComplete: string, maxLength?: number) {
    return <div className="auth-field"><label htmlFor={`auth-${name}`}>{label}</label><input id={`auth-${name}`} className="catalog-control" name={name} type={type} autoComplete={autoComplete} value={values[name]} onChange={event => change(name, event.target.value)} required disabled={busy} maxLength={maxLength} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `auth-${name}-error` : name === 'password' && signup ? 'auth-password-help' : undefined} />{errors[name] && <p className="auth-field-error" id={`auth-${name}-error`}>{errors[name]}</p>}</div>
  }

  return <main className="auth-screen"><section className="panel auth-card" aria-labelledby="auth-title">
    <a className="brand auth-brand" href="#login"><span className="brand-icon"><Boxes size={24} /></span>Inventra</a>
    <h1 id="auth-title">{signup ? 'Create your account' : 'Welcome back'}</h1>
    <p className="auth-description">{signup ? 'Get started with your Inventra workspace.' : 'Sign in to your Inventra workspace.'}</p>
    {oauthError && <div className="auth-error" role="alert"><p>{oauthError}</p><button type="button" className="text-link" onClick={onDismissOAuthError}>Dismiss</button></div>}
    {failure && <p className="auth-error" role="alert">{failure}</p>}
    <form ref={form} noValidate onSubmit={submit} aria-busy={busy}>
      {signup && field('name', 'Full name', 'text', 'name', 150)}
      {field('email', 'Email address', 'email', signup ? 'email' : 'username', 254)}
      {field('password', 'Password', 'password', signup ? 'new-password' : 'current-password')}
      {signup && <><p id="auth-password-help" className="auth-help">Use at least 12 characters. Passwords are case-sensitive.</p>{field('confirmPassword', 'Confirm password', 'password', 'new-password')}</>}
      <button className="primary-button auth-wide" type="submit" disabled={busy}>{auth.pending && <LoaderCircle className="auth-spinner" size={17} />}{auth.pending ? (signup ? 'Creating account…' : 'Signing in…') : (signup ? 'Create account' : 'Sign in')}</button>
    </form>
    <div className="auth-divider"><span>or</span></div>
    <button className="secondary-button auth-wide auth-google" type="button" onClick={google} disabled={busy}>{redirecting ? <LoaderCircle className="auth-spinner" size={17} /> : <span className="auth-google-mark" aria-hidden="true">G</span>}{redirecting ? 'Opening Google…' : 'Continue with Google'}</button>
    <p className="auth-switch">{signup ? 'Already have an account?' : 'New to Inventra?'} <a className="text-link" href={signup ? '#login' : '#signup'}>{signup ? 'Sign in' : 'Create an account'}</a></p>
  </section></main>
}
