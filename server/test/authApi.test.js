const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const session = require('express-session');
const argon2 = require('argon2');
const { createAuthRouter } = require('../src/routes/authRoutes');
const { readAuthConfig, SESSION_MAX_AGE } = require('../src/config/auth');
const errorHandler = require('../src/middleware/errorHandler');
const pool = require('../src/config/db');

const ORIGIN = 'http://localhost:5173';
const config = readAuthConfig({ NODE_ENV: 'test', SESSION_SECRET: 'a'.repeat(64), CLIENT_URL: ORIGIN });
const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada', email: 'ada@example.com' };
const password = 'correct horse battery staple';
let store;
let server, base, passwordHash;

function makeApp(customStore = store, customConfig = config) {
  const app = express();
  if (customConfig.trustProxy) app.set('trust proxy', customConfig.trustProxy);
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/auth', createAuthRouter({ config: customConfig, store: customStore }));
  app.use(errorHandler);
  return app;
}

before(async () => {
  // Actual native Argon2 hashing and verification; database access is always mocked.
  passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
});
beforeEach(async t => {
  store = new session.MemoryStore();
  t.mock.method(pool, 'query', async () => { throw Error('Unexpected database access'); });
  t.mock.method(pool, 'connect', async () => { throw Error('Unexpected database connection'); });
  server = http.createServer(makeApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
});
after(async () => { await pool.end(); });

async function request(path, { method = 'GET', body, cookie, origin = ORIGIN, headers = {} } = {}) {
  const response = await fetch(base + '/api/auth' + path, {
    method, headers: { ...(origin ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'), headers: response.headers };
}
const credentials = { email: user.email, password };
function mockUsers(t, handler = () => ({ rows: [{ ...user, password_hash: passwordHash }], rowCount: 1 })) {
  t.mock.method(pool, 'query', async (sql, values) => handler(sql, values));
}
function storeGet(sid) { return new Promise((resolve, reject) => store.get(sid, (error, value) => error ? reject(error) : resolve(value))); }
function storeSet(sid, value) { return new Promise((resolve, reject) => store.set(sid, value, error => error ? reject(error) : resolve())); }
function sidFrom(cookie) { return decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('=')).slice(2).split('.')[0]; }

test('register normalizes identity, hashes with Argon2id, saves a session, and returns only public user fields', async t => {
  mockUsers(t, async (sql, values) => {
    assert.match(sql, /^INSERT INTO public.users/);
    assert.match(sql, /RETURNING id, name, email$/);
    assert.deepEqual(values.slice(1, 3), ['Ada', user.email]);
    assert.match(values[3], /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    assert.equal(await argon2.verify(values[3], password), true);
    return { rows: [user], rowCount: 1 };
  });
  const response = await request('/register', { method: 'POST', body: { name: ' Ada ', email: ' ADA@EXAMPLE.COM ', password } });
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { success: true, data: user });
  assert.match(response.cookie, /HttpOnly/);
  assert.match(response.cookie, /SameSite=Lax/);
  assert.match(response.cookie, /Path=\//);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const saved = await storeGet(sidFrom(response.cookie));
  assert.equal(saved.userId, user.id);
  assert.ok(saved.authenticatedAt <= Date.now());
  assert.equal(JSON.stringify(saved).includes(password), false);
});

test('duplicate email returns safe 409 and creates no session', async t => {
  mockUsers(t, () => { throw Object.assign(Error('private constraint SQL'), { code: '23505' }); });
  const response = await request('/register', { method: 'POST', body: { name: user.name, ...credentials } });
  assert.equal(response.status, 409);
  assert.match(response.body.message, /email already exists/);
  assert.equal(response.cookie, null);
});

test('login rotates session; me loads current public user; logout destroys and clears cookie', async t => {
  mockUsers(t, (sql, values) => {
    assert.ok(sql.includes('WHERE lower(email) = lower($1)') || sql.includes('WHERE id = $1'));
    assert.deepEqual(values, [sql.includes('lower(email)') ? user.email : user.id]);
    return { rows: [{ ...user, password_hash: passwordHash }], rowCount: 1 };
  });
  const first = await request('/login', { method: 'POST', body: credentials });
  assert.equal(first.status, 200);
  const second = await request('/login', { method: 'POST', body: credentials, cookie: first.cookie });
  assert.equal(second.status, 200);
  assert.notEqual(sidFrom(first.cookie), sidFrom(second.cookie));
  assert.equal(await storeGet(sidFrom(first.cookie)), undefined);
  assert.deepEqual((await request('/me', { cookie: second.cookie })).body, { success: true, data: user });
  assert.equal((await request('/me', { cookie: first.cookie })).status, 401);
  const logout = await request('/logout', { method: 'POST', body: {}, cookie: second.cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.cookie, /inventra.sid=;/);
  assert.match(logout.cookie, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('/me', { cookie: second.cookie })).status, 401);
  assert.equal((await request('/logout', { method: 'POST', body: {} })).status, 200);
});

test('unknown email, wrong password, and malformed stored hashes have identical login errors', async t => {
  for (const rows of [[], [{ ...user, password_hash: passwordHash }], [{ ...user, password_hash: 'broken' }], [{ ...user, password_hash: null }]]) {
    mockUsers(t, () => ({ rows, rowCount: rows.length }));
    const response = await request('/login', { method: 'POST', body: { ...credentials, password: 'wrong' } });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { success: false, message: 'Invalid email or password' });
    assert.equal(response.cookie, null);
  }
});

test('invalid input is rejected before any user query', async () => {
  for (const body of [null, [], {}, { ...credentials, email: 'invalid' }, { ...credentials, password: 12 }, { ...credentials, password: 'a'.repeat(1025) }, { ...credentials, user_id: user.id }]) {
    assert.equal((await request('/login', { method: 'POST', body })).status, 400);
  }
  for (const body of [{ name: ' ', ...credentials }, { name: user.name, ...credentials, password: 'short' }]) {
    assert.equal((await request('/register', { method: 'POST', body })).status, 400);
  }
});

test('unsafe requests require exact Origin, reject missing/null/foreign origins and non-JSON', async () => {
  for (const origin of [null, 'null', 'https://evil.example', ORIGIN + '.evil.example']) {
    for (const path of ['/login', '/register', '/logout']) {
      assert.equal((await request(path, { method: 'POST', body: {}, origin })).status, 403);
    }
  }
  assert.equal((await request('/login', { method: 'POST' })).status, 415);
});

test('missing, tampered, deleted-user, malformed and expired sessions return 401', async t => {
  assert.equal((await request('/me')).status, 401);
  assert.equal((await request('/me', { cookie: 'inventra.sid=s%3Afake.invalid' })).status, 401);
  mockUsers(t);
  for (const invalid of [{ userId: 'invalid' }, { authenticatedAt: Date.now() - SESSION_MAX_AGE - 1 }, { authenticatedAt: Date.now() + 60000 }, { deleted: true }, { expired: true }]) {
    mockUsers(t);
    const login = await request('/login', { method: 'POST', body: credentials });
    const sid = sidFrom(login.cookie);
    const saved = await storeGet(sid);
    if (invalid.deleted) mockUsers(t, () => ({ rows: [], rowCount: 0 }));
    else {
      Object.assign(saved, invalid);
      if (invalid.expired) saved.cookie.expires = new Date(Date.now() - 1000).toISOString();
      await storeSet(sid, saved);
    }
    assert.equal((await request('/me', { cookie: login.cookie })).status, 401);
    assert.equal(await storeGet(sid), undefined);
  }
});

test('credential endpoint rate limit is shared between login and register', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await request('/login', { method: 'POST', body: {} })).status, 400);
  const response = await request('/register', { method: 'POST', body: {} });
  assert.equal(response.status, 429);
  assert.ok(response.headers.get('retry-after'));
});

test('database and session failures return safe errors without logging in', async t => {
  mockUsers(t, () => { throw Object.assign(Error('secret connection details'), { code: 'ECONNREFUSED' }); });
  assert.equal((await request('/login', { method: 'POST', body: credentials })).status, 503);
  mockUsers(t);
  for (const operation of ['set', 'destroy']) {
    const failure = t.mock.method(store, operation, (sid, data, callback) => (callback || data)(Error('private session details')));
    const response = await request('/login', { method: 'POST', body: credentials });
    assert.equal(response.status, 503);
    assert.equal(response.cookie, null);
    assert.deepEqual(response.body, { success: false, message: 'Internal server error' });
    failure.mock.restore();
  }
  const login = await request('/login', { method: 'POST', body: credentials });
  t.mock.method(store, 'get', (sid, callback) => callback(Error('private database details')));
  const response = await request('/me', { cookie: login.cookie });
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(response.body).includes('private'), false);
});

test('production config requires secrets and HTTPS and uses host-only secure cookies', () => {
  const env = { NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(64), CLIENT_URL: 'https://inventra.example' };
  const production = readAuthConfig(env);
  assert.equal(production.cookieName, '__Host-inventra.sid');
  assert.equal(production.cookie.secure, true);
  assert.equal(production.cookie.httpOnly, true);
  assert.equal(production.cookie.maxAge, SESSION_MAX_AGE);
  assert.equal(production.cookie.domain, undefined);
  for (const overrides of [{ SESSION_SECRET: '' }, { SESSION_SECRET: 'short' }, { CLIENT_URL: '' }, { CLIENT_URL: ORIGIN }, { CLIENT_URL: env.CLIENT_URL + '/' }, { SESSION_SAME_SITE: 'bad' }, { TRUST_PROXY: 'true' }]) {
    assert.throws(() => readAuthConfig({ ...env, ...overrides }));
  }
  assert.equal(readAuthConfig({ ...env, SESSION_SAME_SITE: 'none' }).cookie.sameSite, 'none');
});

test('production rejects HTTP and issues Secure cookies only through an explicitly trusted TLS proxy', async t => {
  const production = readAuthConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(64), CLIENT_URL: 'https://inventra.example', TRUST_PROXY: 'loopback' });
  const productionServer = http.createServer(makeApp(store, production));
  await new Promise(resolve => productionServer.listen(0, '127.0.0.1', resolve));
  t.after(async () => { productionServer.closeAllConnections(); await new Promise(resolve => productionServer.close(resolve)); });
  const url = `http://127.0.0.1:${productionServer.address().port}/api/auth/login`;
  const options = { method: 'POST', headers: { Origin: production.clientUrl, 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) };
  assert.equal((await fetch(url, options)).status, 400);
  mockUsers(t);
  const response = await fetch(url, { ...options, headers: { ...options.headers, 'X-Forwarded-Proto': 'https' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /^__Host-inventra.sid=/);
  assert.match(response.headers.get('set-cookie'), /; Secure/);
});

test('actual app uses credentialed CORS and public.session through the existing mocked pg pool', async t => {
  const oldEnv = { SESSION_SECRET: process.env.SESSION_SECRET, NODE_ENV: process.env.NODE_ENV, CLIENT_URL: process.env.CLIENT_URL, TRUST_PROXY: process.env.TRUST_PROXY };
  Object.assign(process.env, { SESSION_SECRET: 'a'.repeat(64), NODE_ENV: 'test', CLIENT_URL: ORIGIN, TRUST_PROXY: '' });
  t.after(() => { for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const app = require('../src/app');
  const appServer = http.createServer(app);
  await new Promise(resolve => appServer.listen(0, '127.0.0.1', resolve));
  t.after(async () => { appServer.closeAllConnections(); await new Promise(resolve => appServer.close(resolve)); });
  const url = `http://127.0.0.1:${appServer.address().port}/api/auth`;
  const sessions = new Map();
  const calls = [];
  mockUsers(t, (sql, values) => {
    calls.push(sql);
    if (sql.includes('FROM products')) {
      assert.match(sql, /user_id = \$1/);
      assert.deepEqual(values, [user.id]);
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT id, name, email')) return { rows: [{ ...user, password_hash: passwordHash }], rowCount: 1 };
    assert.match(sql, /"public"\."session"/);
    if (sql.startsWith('INSERT INTO')) {
      const [sess, expire, sid] = values;
      assert.ok(expire >= Date.now() / 1000 + SESSION_MAX_AGE / 1000 - 2);
      sessions.set(sid, JSON.parse(JSON.stringify(sess)));
    } else if (sql.startsWith('SELECT sess')) return { rows: sessions.has(values[0]) ? [{ sess: sessions.get(values[0]) }] : [] };
    else if (sql.startsWith('DELETE FROM')) sessions.delete(values[0]);
    else assert.fail('Unexpected store SQL');
    return { rows: [], rowCount: 0 };
  });
  const preflight = await fetch(url + '/login', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  const foreign = await fetch(url + '/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
  assert.equal(foreign.status, 403);
  assert.equal(calls.length, 0);
  const login = await fetch(url + '/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.equal(sessions.size, 1);
  const businessUrl = url.replace(/\/auth$/, '/products');
  const products = await fetch(businessUrl, { headers: { Cookie: cookie, Origin: ORIGIN } });
  assert.equal(products.status, 200);
  const me = await fetch(url + '/me', { headers: { Cookie: cookie, Origin: ORIGIN } });
  assert.deepEqual(await me.json(), { success: true, data: user });
  const logout = await fetch(url + '/logout', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(logout.status, 200);
  assert.equal(sessions.size, 0);
  assert.equal((await fetch(businessUrl, { headers: { Cookie: cookie } })).status, 401);
  assert.ok(!calls.some(sql => /CREATE|ALTER|UPDATE /.test(sql.replace('DO UPDATE SET', ''))));
});
