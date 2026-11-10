import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, createApiClient } from './api.ts'
import { createAuthStore, GOOGLE_SIGN_IN_URL, validateAuthForm } from '../auth/authStore.ts'
import { oauthErrorMessage, routeDecision, workspaceRoutes } from '../auth/authRouting.ts'

const user = { id: 'user-id', name: 'Ada', email: 'ada@example.com' }
const success = { success: true, data: user }
const unauthorized = () => new ApiError('http', 'Authentication required', 401)
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('startup restores the session through the shared credentialed fetch client and keeps only public user data', async () => {
  const calls = []
  const api = createApiClient('http://localhost:5000', async (url, options) => {
    calls.push({ url, ...options })
    return Response.json({ success: true, data: { ...user, password_hash: 'never retain', token: 'never retain' } })
  })
  const store = createAuthStore(api)
  assert.equal(store.getSnapshot().status, 'checking')
  await store.restore()
  assert.deepEqual(store.getSnapshot(), { status: 'authenticated', user, pending: false, error: null })
  assert.equal(calls[0].url, 'http://localhost:5000/api/auth/me')
  assert.equal(calls[0].credentials, 'include')
  assert.equal(JSON.stringify(store.getSnapshot()).includes('never retain'), false)
})

test('restore treats 401 as signed out but outages and malformed accounts as retryable errors', async () => {
  for (const [failure, status] of [[unauthorized(), 'anonymous'], [new ApiError('network', 'Unable to reach the API'), 'error']]) {
    const store = createAuthStore({ get: async () => { throw failure } })
    await store.restore()
    assert.equal(store.getSnapshot().status, status)
    assert.equal(store.getSnapshot().user, null)
  }
  let valid = false
  const retry = createAuthStore({ get: async () => valid ? success : { success: true, data: { name: 'Missing identity' } } })
  await retry.restore()
  assert.equal(retry.getSnapshot().status, 'error')
  valid = true
  await retry.restore()
  assert.equal(retry.getSnapshot().status, 'authenticated')
})

test('StrictMode restores coalesce and late startup responses cannot undo login', async () => {
  const pending = deferred()
  let reads = 0
  const store = createAuthStore({ get: () => { reads++; return pending.promise }, post: async () => success })
  const first = store.restore(), second = store.restore()
  assert.equal(reads, 1)
  await store.login({ email: user.email, password: 'a password' })
  pending.reject(unauthorized())
  await Promise.all([first, second])
  assert.equal(store.getSnapshot().status, 'authenticated')
})

test('login, registration and logout use only auth endpoints with JSON and cookies', async () => {
  const calls = []
  const client = createApiClient('http://localhost:5000', async (url, options) => {
    calls.push({ url, ...options })
    return Response.json(url.endsWith('/logout') ? { success: true } : success)
  })
  const store = createAuthStore(client)
  const credentials = { email: user.email, password: 'password not persisted' }
  await store.login(credentials)
  assert.equal(store.getSnapshot().user.id, user.id)
  await store.register({ ...credentials, name: user.name })
  await store.logout()
  assert.deepEqual(store.getSnapshot(), { status: 'anonymous', user: null, pending: false, error: null })
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/api/auth/login', '/api/auth/register', '/api/auth/logout'])
  for (const call of calls) {
    assert.equal(call.method, 'POST')
    assert.equal(call.credentials, 'include')
    assert.equal(call.headers.get('Content-Type'), 'application/json')
  }
  assert.deepEqual(JSON.parse(calls[0].body), credentials)
  assert.deepEqual(JSON.parse(calls[1].body), { ...credentials, name: user.name })
  assert.deepEqual(JSON.parse(calls[2].body), {})
  assert.equal(JSON.stringify(store.getSnapshot()).includes(credentials.password), false)
})

test('failed login remains anonymous; failed logout preserves the user and supports retry', async () => {
  let fail = true
  const store = createAuthStore({ get: async () => { throw unauthorized() }, post: async () => { if (fail) throw new ApiError('http', 'Invalid email or password', 401); return success } })
  await store.restore()
  await assert.rejects(store.login({ email: user.email, password: 'wrong' }))
  assert.equal(store.getSnapshot().status, 'anonymous')
  assert.equal(store.getSnapshot().pending, false)
  assert.equal(store.getSnapshot().error, 'Invalid email or password')
  fail = false
  await store.login({ email: user.email, password: 'correct' })
  const outage = createAuthStore({ get: async () => success, post: async () => { throw new ApiError('network', 'Unable to reach the API') } })
  await outage.restore()
  await assert.rejects(outage.logout())
  assert.equal(outage.getSnapshot().status, 'authenticated')
  assert.deepEqual(outage.getSnapshot().user, user)
  assert.equal(outage.getSnapshot().pending, false)
  const expired = createAuthStore({ get: async () => success, post: async () => { throw unauthorized() } })
  await expired.restore()
  await expired.logout()
  assert.equal(expired.getSnapshot().status, 'anonymous')
})

test('duplicate mutations are rejected and late restore success cannot restore a logged-out user', async () => {
  const pending = deferred()
  let writes = 0
  const store = createAuthStore({ get: async () => success, post: () => { writes++; return pending.promise } })
  await store.restore()
  const logout = store.logout()
  assert.equal(store.getSnapshot().pending, true)
  await assert.rejects(store.logout())
  assert.equal(writes, 1)
  pending.resolve({ success: true })
  await logout
  const late = deferred()
  const racing = createAuthStore({ get: () => late.promise, post: async () => ({ success: true }) })
  const restore = racing.restore()
  await racing.logout()
  late.resolve(success)
  await restore
  assert.equal(racing.getSnapshot().status, 'anonymous')
})

test('every workspace route is closed during checking/errors and redirects anonymous users to login', () => {
  for (const route of workspaceRoutes) {
    assert.deepEqual(routeDecision(`#${route}`, 'checking'), { view: 'checking', redirect: null })
    assert.deepEqual(routeDecision(`#${route}`, 'error'), { view: 'error', redirect: null })
    assert.deepEqual(routeDecision(`#${route}`, 'anonymous'), { view: 'login', redirect: '#login' })
    assert.deepEqual(routeDecision(`#${route}`, 'authenticated'), { view: 'application', redirect: null })
  }
  assert.deepEqual(routeDecision('#signup', 'anonymous'), { view: 'signup', redirect: null })
  assert.deepEqual(routeDecision('#login', 'authenticated'), { view: 'application', redirect: '#dashboard' })
  assert.deepEqual(routeDecision('#/orders', 'authenticated'), { view: 'application', redirect: '#orders' })
  assert.deepEqual(routeDecision('#https://evil.example', 'anonymous'), { view: 'login', redirect: '#login' })
})

test('OAuth redirects use the backend URL and untrusted callback errors become fixed safe messages', () => {
  assert.equal(GOOGLE_SIGN_IN_URL, 'http://localhost:5000/api/auth/google')
  assert.match(oauthErrorMessage('?auth_error=account_conflict'), /existing method/)
  assert.match(oauthErrorMessage('?auth_error=google_sign_in_failed'), /could not be completed/)
  const malicious = '<script>private</script>'
  assert.equal(oauthErrorMessage(`?auth_error=${encodeURIComponent(malicious)}`).includes(malicious), false)
  assert.equal(oauthErrorMessage(''), null)
})

test('signup validation matches backend limits, checks confirmation and preserves password whitespace', () => {
  const values = { name: ' Ada ', email: ' ada@example.com ', password: '  a long password  ', confirmPassword: '  a long password  ' }
  assert.deepEqual(validateAuthForm('signup', values), {})
  assert.deepEqual(validateAuthForm('login', { ...values, password: 'old' }), {})
  assert.ok(validateAuthForm('signup', { ...values, password: 'short' }).password)
  assert.ok(validateAuthForm('signup', { ...values, confirmPassword: 'different' }).confirmPassword)
  assert.ok(validateAuthForm('signup', { ...values, password: 'é'.repeat(513) }).password)
  assert.ok(validateAuthForm('signup', { ...values, name: ' ', email: 'bad' }).name)
  assert.ok(validateAuthForm('login', { ...values, email: 'bad' }).email)
})
