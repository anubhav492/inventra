const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
const session = require('express-session');
const oidc = require('openid-client');
const { createApp } = require('../src/app');
const { readAuthConfig } = require('../src/config/auth');
const { readGoogleConfig } = require('../src/config/google');
const { createGoogleOidc } = require('../src/services/googleOidc');
const { ATTEMPT_MAX_AGE } = require('../src/controllers/googleController');
const pool = require('../src/config/db');

const settings = { clientId: 'test-client', clientSecret: 'test-client-secret', callbackUrl: 'http://localhost:5000/api/auth/google/callback' };
const authConfig = readAuthConfig({ SESSION_SECRET: 'test-secret-'.repeat(8), CLIENT_URL: 'http://localhost:5173', NODE_ENV: 'test' });
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const EXISTING_ID = '11111111-1111-4111-8111-111111111111';
const claims = { sub: 'google-stable-subject', email: 'google@example.com', email_verified: true, name: 'Google Person' };
const row = rows => ({ rows, rowCount: rows.length });
let server, base, store, attempt, tokenClaims, tokenError, fetchCalls, queryCalls, transactions, mode, logs, diagnostics;

function storeGet(sid) { return new Promise((resolve, reject) => store.get(sid, (error, value) => error ? reject(error) : resolve(value))); }
function storeSet(sid, value) { return new Promise((resolve, reject) => store.set(sid, value, error => error ? reject(error) : resolve())); }
function sidFrom(cookie) { return decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('=')).slice(2).split('.')[0]; }
function jwt(payload, signingKey = keys.privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${encoded}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), signingKey).toString('base64url')}`;
}

beforeEach(async t => {
  store = new session.MemoryStore();
  attempt = undefined; tokenClaims = {}; tokenError = undefined; fetchCalls = []; queryCalls = []; transactions = []; mode = 'new'; logs = []; diagnostics = [];
  t.mock.method(console, 'error', (...args) => {
    logs.push(args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '));
    if (args[0] === 'Google sign-in failed') diagnostics.push(args[1]);
  });
  t.after(() => {
    const output = logs.join('\n');
    for (const sensitive of [settings.clientSecret, claims.email, claims.name, claims.sub, 'private-access-token', 'private-authorization-code', 'private-provider-details', 'private-network-secret', 'private identity SQL', 'private diagnostic payload']) {
      assert.equal(output.includes(sensitive), false, 'Diagnostics must not expose private data');
    }
    if (attempt) for (const value of [attempt.state, attempt.nonce, attempt.verifier]) assert.equal(output.includes(value), false);
  });
  const config = new oidc.Configuration({
    issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_endpoint: 'https://oauth2.googleapis.com/token', jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
  }, settings.clientId, { client_secret: settings.clientSecret, id_token_signed_response_alg: 'RS256' }, oidc.ClientSecretPost(settings.clientSecret));
  config[oidc.customFetch] = async (url, options) => {
    fetchCalls.push(String(url));
    if (String(url).includes('/certs')) return Response.json({ keys: [jwk] });
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('client_id'), settings.clientId);
    assert.equal(body.get('client_secret'), settings.clientSecret);
    assert.equal(body.get('code_verifier'), attempt.verifier);
    assert.equal(body.get('redirect_uri'), settings.callbackUrl);
    if (tokenError) {
      if (tokenError instanceof Error) throw tokenError;
      return Response.json(tokenError, { status: 400 });
    }
    const now = Math.floor(Date.now() / 1000);
    const idToken = jwt({ ...claims, iss: 'https://accounts.google.com', aud: settings.clientId, iat: now, exp: now + 300, nonce: attempt.nonce, ...tokenClaims }, mode === 'bad-signature' ? otherKeys.privateKey : keys.privateKey);
    return Response.json({ access_token: 'private-access-token', token_type: 'Bearer', expires_in: 300, id_token: idToken });
  };
  const provider = createGoogleOidc({ settings, client: { ...oidc, async discovery(issuer, id, metadata, auth, options) {
    assert.equal(issuer.href, 'https://accounts.google.com/');
    assert.equal(id, settings.clientId);
    assert.equal(metadata.id_token_signed_response_alg, 'RS256');
    assert.equal(options.timeout, 10);
    assert.ok(options.execute.includes(oidc.enableNonRepudiationChecks));
    for (const execute of options.execute) execute(config);
    return config;
  } } });
  server = http.createServer(createApp({ config: authConfig, store, googleProvider: provider }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  t.mock.method(pool, 'query', async (sql, values) => {
    queryCalls.push({ sql, values });
    if (sql.startsWith('UPDATE public.session')) {
      assert.match(sql, /expire > NOW\(\).*googleOAuth/s);
      assert.match(sql, /WHERE sid = \$1/);
      assert.match(sql, /->>'state' = \$2/);
      const saved = await storeGet(values[0]);
      if (!saved?.googleOAuth || saved.googleOAuth.state !== values[1]) return row([]);
      delete saved.googleOAuth;
      await storeSet(values[0], saved);
      return row([{ sid: values[0] }]);
    }
    if (sql === 'SELECT id, name, email FROM public.users WHERE id = $1') return row([{ id: values[0], name: claims.name, email: claims.email }]);
    if (sql.includes('FROM products')) { assert.deepEqual(values, [EXISTING_ID]); assert.match(sql, /user_id = \$1/); return row([]); }
    assert.fail('Unexpected pool query');
  });
  t.mock.method(pool, 'connect', async () => ({
    async query(sql, values) {
      transactions.push({ sql, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return row([]);
      if (mode === 'database-failure') throw Error('secret database URL');
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) { assert.deepEqual(values, [`google:${claims.sub}`]); return row([]); }
      if (sql.includes('FROM public.account_identities')) {
        if (mode === 'rls-failure') throw Object.assign(Error('private diagnostic payload'), { code: '42501', detail: claims.email });
        if (mode === 'schema-failure') throw Object.assign(Error('private diagnostic payload'), { code: '42P01', detail: claims.sub });
        assert.deepEqual(values, ['google', claims.sub]);
        assert.match(sql, /JOIN public.users u ON u.id = a.user_id/);
        return row(mode === 'returning' ? [{ id: EXISTING_ID, name: claims.name, email: 'original@example.com' }] : []);
      }
      if (sql.startsWith('SELECT id FROM public.users')) { assert.deepEqual(values, [claims.email]); return row(mode === 'conflict' ? [{ id: EXISTING_ID }] : []); }
      if (sql.startsWith('INSERT INTO public.users')) {
        assert.match(sql, /password_hash\)\s+VALUES \(\$1, \$2, \$3, NULL\)/);
        assert.deepEqual(values.slice(1), [claims.name, claims.email]);
        if (mode === 'email-race') throw Object.assign(Error('private email index details'), { code: '23505' });
        return row([{ id: EXISTING_ID, name: claims.name, email: claims.email }]);
      }
      if (sql.startsWith('INSERT INTO public.account_identities')) {
        assert.deepEqual(values, ['google', claims.sub, EXISTING_ID]);
        if (mode === 'identity-failure') throw Error('private identity SQL');
        return row([]);
      }
      assert.fail('Unexpected transaction query');
    }, release() { transactions.push({ sql: 'RELEASE' }); },
  }));
});
after(async () => { await pool.end(); });

async function begin() {
  const response = await fetch(base + '/api/auth/google', { redirect: 'manual' });
  assert.equal(response.status, 302);
  const cookie = response.headers.get('set-cookie');
  const saved = await storeGet(sidFrom(cookie));
  attempt = saved.googleOAuth;
  return { cookie, url: new URL(response.headers.get('location')) };
}
async function callback(cookie, query = { state: attempt.state, code: 'private-authorization-code' }) {
  return fetch(base + '/api/auth/google/callback?' + new URLSearchParams(query), { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
}
function failure(response, marker = 'google_sign_in_failed') {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), `http://localhost:5173/?auth_error=${marker}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
}

test('initiation saves fresh state, nonce and S256 PKCE before redirecting; verifier stays server-side', async () => {
  const { cookie, url } = await begin();
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), settings.callbackUrl);
  assert.equal(url.searchParams.get('state'), attempt.state);
  assert.equal(url.searchParams.get('nonce'), attempt.nonce);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(attempt.verifier).digest('base64url'));
  assert.ok(attempt.state.length >= 32 && attempt.nonce.length >= 32 && attempt.verifier.length >= 43);
  assert.equal(url.href.includes(attempt.verifier), false);
  assert.equal(url.href.includes(settings.clientSecret), false);
  assert.match(cookie, /HttpOnly/);
  assert.equal(fetchCalls.length, 0);
  assert.equal(queryCalls.length, 0);
});

test('new Google users get a null local password and atomic identity mapping, followed by session rotation', async () => {
  const { cookie } = await begin();
  const response = await callback(cookie);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'http://localhost:5173/');
  const authenticatedCookie = response.headers.get('set-cookie');
  assert.notEqual(sidFrom(authenticatedCookie), sidFrom(cookie));
  assert.equal(await storeGet(sidFrom(cookie)), undefined);
  const saved = await storeGet(sidFrom(authenticatedCookie));
  assert.equal(saved.userId, EXISTING_ID);
  assert.ok(saved.authenticatedAt);
  assert.equal(saved.googleOAuth, undefined);
  assert.equal(JSON.stringify(saved).includes('private-access-token'), false);
  assert.equal(transactions.filter(({ sql }) => sql === 'COMMIT').length, 1);
  assert.equal((await fetch(base + '/api/products', { headers: { Cookie: authenticatedCookie } })).status, 200);
});

test('returning users are resolved by stable sub, keeping the stored email and creating no user or identity', async () => {
  mode = 'returning';
  const { cookie } = await begin();
  const response = await callback(cookie);
  assert.equal(response.headers.get('location'), 'http://localhost:5173/');
  assert.equal(transactions.some(({ sql }) => sql.startsWith('INSERT') || sql.includes('lower(email)')), false);
});

test('matching password-account emails are never linked, including a concurrent email insert race', async () => {
  for (const scenario of ['conflict', 'email-race']) {
    mode = scenario;
    transactions = [];
    const { cookie } = await begin();
    const response = await callback(cookie);
    failure(response, 'account_conflict');
    assert.ok(transactions.some(({ sql }) => sql === 'ROLLBACK'));
    assert.equal(transactions.some(({ sql }) => sql.startsWith('INSERT INTO public.account_identities')), false);
    assert.equal(transactions.some(({ sql }) => sql.startsWith('UPDATE public.users')), false);
    assert.equal((await storeGet(sidFrom(cookie))).userId, undefined);
  }
});

test('missing, incorrect, duplicated and expired state fail before exchange or account queries', async () => {
  for (const scenario of ['missing-cookie', 'missing-state', 'wrong-state', 'expired', 'duplicate-state']) {
    const { cookie } = await begin();
    if (scenario === 'expired') {
      const saved = await storeGet(sidFrom(cookie));
      saved.googleOAuth.createdAt = Date.now() - ATTEMPT_MAX_AGE - 1;
      await storeSet(sidFrom(cookie), saved);
    }
    const query = scenario === 'duplicate-state' ? [['state', attempt.state], ['state', attempt.state], ['code', 'private-code']]
      : { ...(scenario === 'missing-state' ? {} : { state: scenario === 'wrong-state' ? 'wrong' : attempt.state }), code: 'private-code' };
    failure(await callback(scenario === 'missing-cookie' ? '' : cookie, query));
  }
  assert.equal(fetchCalls.length, 0);
  assert.equal(queryCalls.length, 0);
  assert.equal(transactions.length, 0);
});

test('real OIDC validation rejects invalid nonce, issuer, audience, expiry, signature and unverified email', async () => {
  for (const overrides of [{ nonce: 'wrong' }, { iss: 'https://evil.example' }, { aud: 'other-client' }, { exp: 1 }, { badSignature: true }, { email_verified: false }, { sub: '' }]) {
    tokenClaims = overrides;
    mode = overrides.badSignature ? 'bad-signature' : 'new';
    const { cookie } = await begin();
    failure(await callback(cookie));
  }
  assert.equal(transactions.length, 0);
  assert.ok(logs.every(line => line.startsWith('Google sign-in failed ')));
});

test('denied consent, token endpoint errors and network errors produce fixed redirects with no token leakage', async () => {
  let started = await begin();
  failure(await callback(started.cookie, { state: attempt.state, error: 'access_denied', error_description: 'private-provider-details' }));
  for (const error of [{ error: 'invalid_grant', error_description: 'private-provider-details' }, Error('private-network-secret')]) {
    tokenError = error;
    started = await begin();
    failure(await callback(started.cookie));
  }
  assert.equal(transactions.length, 0);
  assert.ok(logs.every(line => line.startsWith('Google sign-in failed ')));
});

test('consumed callbacks cannot be replayed and account failures roll back without logging in', async () => {
  for (const scenario of ['database-failure', 'identity-failure']) {
    mode = scenario;
    transactions = [];
    const { cookie } = await begin();
    failure(await callback(cookie));
    assert.ok(transactions.some(({ sql }) => sql === 'ROLLBACK'));
    assert.equal(transactions.some(({ sql }) => sql === 'COMMIT'), false);
    assert.equal((await storeGet(sidFrom(cookie))).userId, undefined);
    const exchanges = fetchCalls.length;
    failure(await callback(cookie));
    assert.equal(fetchCalls.length, exchanges);
  }
});

test('Google configuration requires a fixed safe callback and never includes credentials in errors', () => {
  assert.deepEqual(readGoogleConfig({ GOOGLE_CLIENT_ID: settings.clientId, GOOGLE_CLIENT_SECRET: settings.clientSecret, GOOGLE_CALLBACK_URL: settings.callbackUrl }), settings);
  for (const overrides of [{ GOOGLE_CLIENT_ID: '' }, { GOOGLE_CLIENT_SECRET: '' }, { GOOGLE_CALLBACK_URL: 'https://evil.example/path' }, { GOOGLE_CALLBACK_URL: settings.callbackUrl + '?returnTo=evil' }, { NODE_ENV: 'production' }]) {
    assert.throws(() => readGoogleConfig({ GOOGLE_CLIENT_ID: settings.clientId, GOOGLE_CLIENT_SECRET: settings.clientSecret, GOOGLE_CALLBACK_URL: settings.callbackUrl, ...overrides }), error => error.status === 503 && error.message === 'Google sign-in is not configured');
  }
});

test('an atomic state claim lost to another callback prevents token exchange and any account work', async t => {
  const { cookie } = await begin();
  t.mock.method(pool, 'query', async sql => { assert.match(sql, /^UPDATE public.session/); return row([]); });
  failure(await callback(cookie));
  assert.equal(fetchCalls.length, 0);
  assert.equal(transactions.length, 0);
});

test('a session-save failure after account commit fails safely and never sends an authenticated cookie', async t => {
  const { cookie } = await begin();
  const originalSet = store.set.bind(store);
  t.mock.method(store, 'set', (sid, saved, callback) => {
    if (saved.userId) return callback(Error('private store credentials'));
    return originalSet(sid, saved, callback);
  });
  const response = await callback(cookie);
  failure(response);
  assert.ok(transactions.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(logs.some(line => line.includes('private store credentials')), false);
});

test('callback URL is fixed despite attacker-controlled Host or returnTo parameters', async () => {
  const { cookie } = await begin();
  const response = await fetch(base + '/api/auth/google/callback?' + new URLSearchParams({ state: attempt.state, code: 'private-code', returnTo: 'https://evil.example' }), {
    headers: { Cookie: cookie, Host: 'evil.example', 'X-Forwarded-Host': 'evil.example' }, redirect: 'manual',
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'http://localhost:5173/');
});

test('discovery failures return a generic fixed redirect and can be retried', async t => {
  const provider = createGoogleOidc({ settings, client: { ...oidc, async discovery() { throw Error('private discovery credentials'); } } });
  const failedServer = http.createServer(createApp({ config: authConfig, store: new session.MemoryStore(), googleProvider: provider }));
  await new Promise(resolve => failedServer.listen(0, '127.0.0.1', resolve));
  t.after(async () => { failedServer.closeAllConnections(); await new Promise(resolve => failedServer.close(resolve)); });
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`http://127.0.0.1:${failedServer.address().port}/api/auth/google`, { redirect: 'manual' });
    failure(response);
  }
  assert.ok(logs.every(line => line.startsWith('Google sign-in failed ')));
  assert.equal(transactions.length, 0);
});

test('diagnostics distinguish missing sessions, state mismatch and consumed attempts without logging values', async t => {
  const { cookie } = await begin();
  failure(await callback('', { state: attempt.state, code: 'private-code' }));
  assert.deepEqual(diagnostics.at(-1), { stage: 'callback_validation', reason: 'missing_attempt', requestCookiePresent: false });
  failure(await callback(cookie, { state: 'wrong', code: 'private-code' }));
  assert.deepEqual(diagnostics.at(-1), { stage: 'callback_validation', reason: 'state_mismatch' });
  t.mock.method(pool, 'query', async () => row([]));
  failure(await callback(cookie));
  assert.deepEqual(diagnostics.at(-1), { stage: 'session_state_consume', reason: 'attempt_already_consumed' });
});

test('diagnostics distinguish RLS/schema errors and account query stages using only whitelisted SQLSTATE', async () => {
  for (const [scenario, code] of [['rls-failure', '42501'], ['schema-failure', '42P01']]) {
    mode = scenario;
    const { cookie } = await begin();
    failure(await callback(cookie));
    assert.deepEqual(diagnostics.at(-1), { stage: 'account_resolution', reason: 'operation_failed', code, accountStage: 'identity_lookup' });
  }
});

test('diagnostics identify token endpoint rejection versus session saving failure without dumping errors', async t => {
  tokenError = { error: 'invalid_client', error_description: 'private diagnostic payload' };
  const first = await begin();
  failure(await callback(first.cookie));
  assert.equal(diagnostics.at(-1).stage, 'token_validation');
  assert.equal(diagnostics.at(-1).providerError, 'invalid_client');
  tokenError = undefined;
  const second = await begin();
  const originalSet = store.set.bind(store);
  t.mock.method(store, 'set', (sid, saved, callback) => saved.userId ? callback(Error('private diagnostic payload')) : originalSet(sid, saved, callback));
  failure(await callback(second.cookie));
  assert.deepEqual(diagnostics.at(-1), { stage: 'session_creation', reason: 'operation_failed', sessionOperation: 'save' });
});

test('diagnostics redact arbitrary error codes and nested causes while preserving known network labels', async () => {
  const { cookie } = await begin();
  tokenError = Object.assign(Error('private diagnostic payload'), {
    code: claims.email,
    cause: { code: 'ECONNRESET', message: settings.clientSecret, claims, authorizationCode: 'private-authorization-code' },
  });
  failure(await callback(cookie));
  assert.deepEqual(diagnostics.at(-1), { stage: 'token_validation', reason: 'operation_failed', code: 'ECONNRESET' });
});
