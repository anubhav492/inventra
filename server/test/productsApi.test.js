const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fixture = require('./helpers/sessionFixture')();
const app = fixture.app;
const pool = require('../src/config/db');

const OWNER = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const product = { id: ID, name: 'Mouse', sku: 'WM-001', price: '799.00', stock_quantity: 25, low_stock_threshold: 5, is_active: true, created_at: '2026-11-08T10:00:00.000Z' };
const result = rows => ({ rows, rowCount: rows.length });
let server, base, cookie;
const originalEnv = { node: process.env.NODE_ENV, user: process.env.DEV_USER_ID };

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async t => {
  process.env.NODE_ENV = 'development'; process.env.DEV_USER_ID = '99999999-9999-4999-8999-999999999999';
  cookie = await fixture.cookie(OWNER);
  queries(t, () => { throw Error('Unexpected business query'); });
});
afterEach(() => {
  process.env.NODE_ENV = originalEnv.node;
  process.env.DEV_USER_ID = originalEnv.user;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });

function queries(t, handler) {
  t.mock.method(pool, 'query', async (sql, values) => {
    if (sql === 'SELECT id, name, email FROM public.users WHERE id = $1') { assert.deepEqual(values, [OWNER]); return result([{ id: OWNER, name: 'Owner', email: 'owner@example.com' }]); }
    return handler(sql, values);
  });
}
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Origin: fixture.config.clientUrl, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('missing sessions fail closed regardless of environment or DEV_USER_ID without querying users/products', async t => {
  cookie = undefined;
  t.mock.method(pool, 'query', () => { throw Error('Must not query'); });
  for (const environment of ['production', 'development', '', 'test']) {
    process.env.NODE_ENV = environment;
    assert.equal((await request('/api/products')).status, 401);
  }
  assert.equal((await request('/')).status, 200);
});
test('deleted session users return 401; DEV_USER_ID cannot restore access', async t => {
  t.mock.method(pool, 'query', async () => result([]));
  for (const id of ['', 'invalid', OWNER]) {
    process.env.DEV_USER_ID = id;
    const response = await request('/api/products');
    assert.equal(response.status, 401);
    assert.equal(response.body.message, 'Authentication required');
  }
});
test('list defaults to active products, newest first, and preserves pg decimal strings', async t => {
  queries(t, (sql, values) => { assert.match(sql, /user_id = \$1/); assert.match(sql, /is_active = true/); assert.match(sql, /ORDER BY created_at DESC/); assert.deepEqual(values, [OWNER]); return result([product]); });
  assert.deepEqual(await request('/api/products'), { status: 200, body: { success: true, count: 1, data: [product] } });
});
test('list status filters, literal search and sorting use scoped parameterized SQL', async t => {
  let latest;
  queries(t, (sql, values) => { latest = { sql, values }; return result([]); });
  for (const [status, expression] of [['all', null], ['active', 'is_active = true'], ['archived', 'is_active = false'], ['in_stock', 'stock_quantity > low_stock_threshold'], ['low_stock', 'stock_quantity > 0 AND stock_quantity <= low_stock_threshold'], ['out_of_stock', 'stock_quantity = 0']]) {
    assert.equal((await request(`/api/products?status=${status}`)).status, 200);
    if (expression) assert.ok(latest.sql.includes(expression));
    else assert.ok(!latest.sql.includes('is_active ='));
  }
  const search = "%'_ OR 1=1--";
  const response = await request(`/api/products?search=${encodeURIComponent(search)}&sortBy=price&sortOrder=asc`);
  assert.equal(response.body.count, 0);
  assert.ok(!latest.sql.includes(search));
  assert.match(latest.sql, /ORDER BY price ASC/);
  assert.equal(latest.values[0], OWNER);
  assert.equal(latest.values[1], "%\\%'\\_ OR 1=1--%");
});
test('invalid/repeated queries and client-supplied identity are rejected', async t => {
  queries(t, () => { throw Error('Product query must not run'); });
  for (const query of ['status=', 'status=unknown', 'sortBy=price%3BDROP%20TABLE%20products', 'sortBy=__proto__', 'sortOrder=sideways', 'search=a&search=b', 'sortBy=name&sortBy=price', `user_id=${OWNER}`]) assert.equal((await request(`/api/products?${query}`)).status, 400, query);
  assert.equal((await request(`/api/products/${ID}?user_id=${OWNER}`)).status, 400);
  assert.equal((await request('/api/products', 'POST', { ...product, user_id: OWNER })).status, 400);
});
test('GET by UUID includes archived products but never another owner', async t => {
  let found = true;
  queries(t, (sql, values) => { assert.match(sql, /id = \$1 AND user_id = \$2/); assert.deepEqual(values, [ID, OWNER]); return result(found ? [{ ...product, is_active: false }] : []); });
  assert.equal((await request(`/api/products/${ID}`)).body.data.is_active, false);
  found = false;
  assert.equal((await request(`/api/products/${ID}`)).status, 404);
  assert.equal((await request('/api/products/not-a-uuid')).status, 400);
});

function transaction(t, { failMovement, failProduct, failRollback, stock = 25 } = {}) {
  const calls = [], releases = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('INSERT INTO products')) { if (failProduct) throw failProduct; return result([{ ...product, stock_quantity: stock }]); }
      if (sql.startsWith('INSERT INTO stock_movements') && failMovement) throw failMovement;
      if (sql === 'ROLLBACK' && failRollback) throw Error('rollback failed');
      return result([]);
    },
    release(discard) { releases.push(discard); },
  };
  t.mock.method(pool, 'connect', async () => client);
  queries(t, () => { throw Error('Transaction must not use pool.query'); });
  return { calls, releases };
}
test('POST creates product and INITIAL_STOCK in one dedicated transaction', async t => {
  const { calls, releases } = transaction(t);
  const response = await request('/api/products', 'POST', { name: ' Mouse ', sku: ' WM-001 ', price: '799.00', stock_quantity: 25 });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.price, '799.00');
  assert.equal(calls[0].sql, 'BEGIN');
  assert.deepEqual(calls[1].values, [OWNER, 'Mouse', 'WM-001', '799.00', 25, 5]);
  assert.match(calls[2].sql, /NULL, 'INITIAL_STOCK', \$3, 0, \$3/);
  assert.deepEqual(calls[2].values, [OWNER, ID, 25, 'Opening stock']);
  assert.equal(calls[3].sql, 'COMMIT');
  assert.deepEqual(releases, [false]);
});
test('zero initial stock uses defaults and does not create a movement', async t => {
  const { calls } = transaction(t, { stock: 0 });
  assert.equal((await request('/api/products', 'POST', { name: 'Mouse', sku: 'WM-001', price: 0 })).status, 201);
  assert.deepEqual(calls[1].values.slice(-2), [0, 5]);
  assert.equal(calls.length, 3);
});
test('creation rolls back on movement failure and returns safe foreign-key errors', async t => {
  const { calls, releases } = transaction(t, { failMovement: Object.assign(Error('internal SQL details'), { code: '23503' }) });
  const response = await request('/api/products', 'POST', { name: 'Mouse', sku: 'WM-001', price: 799, stock_quantity: 25 });
  assert.equal(response.status, 400);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!calls.some(call => call.sql === 'COMMIT'));
  assert.deepEqual(releases, [false]);
  assert.ok(!JSON.stringify(response.body).includes('internal SQL'));
});
test('duplicate SKU returns 409 and discards a client if rollback fails', async t => {
  const { calls, releases } = transaction(t, { failProduct: Object.assign(Error('duplicate'), { code: '23505' }), failRollback: true });
  assert.equal((await request('/api/products', 'POST', { name: 'Mouse', sku: 'WM-001', price: 799 })).status, 409);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(releases, [true]);
});
test('invalid body validation runs before pool.connect', async t => {
  queries(t, () => result([]));
  t.mock.method(pool, 'connect', () => { throw Error('Must not acquire'); });
  for (const body of [{ name: 'Mouse', sku: 'WM', price: -1 }, { name: 'Mouse', sku: 'WM', price: 1, stock_quantity: 1.5 }, { name: 'Mouse', sku: 'WM', price: 1, id: ID }, [], {}, { name: 'Mouse', sku: 'WM', price: '1.001' }]) assert.equal((await request('/api/products', 'POST', body)).status, 400);
});
test('pool acquisition failure returns 503 rather than escaping the handler', async t => {
  queries(t, () => result([]));
  t.mock.method(pool, 'connect', async () => { throw Object.assign(Error('private connection URL'), { code: 'ECONNREFUSED' }); });
  const response = await request('/api/products', 'POST', { name: 'Mouse', sku: 'WM', price: 1 });
  assert.deepEqual(response, { status: 503, body: { success: false, message: 'Database temporarily unavailable' } });
});
test('PATCH updates only supplied fields and includes ownership and active predicate', async t => {
  queries(t, (sql, values) => { assert.match(sql, /SET name = \$1, price = \$2::numeric/); assert.match(sql, /user_id = \$4 AND is_active = true/); assert.deepEqual(values, ['Mouse Pro', '999.00', ID, OWNER]); return result([{ ...product, name: 'Mouse Pro', price: '999.00' }]); });
  assert.equal((await request(`/api/products/${ID}`, 'PATCH', { name: ' Mouse Pro ', price: 999 })).status, 200);
});
test('PATCH rejects stock edits, empty bodies and forbidden product fields', async t => {
  queries(t, () => { throw Error('No product query allowed'); });
  for (const body of [{}, { stock_quantity: 5 }, { is_active: false }, { created_at: 'now' }, { name: ' ' }, { low_stock_threshold: null }]) assert.equal((await request(`/api/products/${ID}`, 'PATCH', body)).status, 400);
});
test('PATCH differentiates owned archived products from inaccessible products', async t => {
  let exists = true;
  queries(t, sql => result(sql.startsWith('SELECT') && exists ? [{ id: ID }] : []));
  assert.equal((await request(`/api/products/${ID}`, 'PATCH', { name: 'Changed' })).status, 409);
  exists = false;
  assert.equal((await request(`/api/products/${ID}`, 'PATCH', { name: 'Changed' })).status, 404);
});
test('archive/restore preserve stock and reject repeated transitions and inaccessible rows', async t => {
  let stateChange = true, exists = true;
  queries(t, (sql, values) => {
    if (sql.startsWith('UPDATE')) {
      assert.ok(!sql.includes('SET stock_quantity'));
      assert.deepEqual(values.slice(1, 3), [ID, OWNER]);
      assert.equal(values[0], !values[3]);
      return result(stateChange ? [{ ...product, is_active: values[0] }] : []);
    }
    return result(exists ? [{ id: ID }] : []);
  });
  for (const action of ['archive', 'restore']) {
    stateChange = true; exists = true;
    assert.equal((await request(`/api/products/${ID}/${action}`, 'PATCH')).body.data.stock_quantity, 25);
    stateChange = false;
    assert.equal((await request(`/api/products/${ID}/${action}`, 'PATCH')).status, 409);
    exists = false;
    assert.equal((await request(`/api/products/${ID}/${action}`, 'PATCH')).status, 404);
    assert.equal((await request(`/api/products/${ID}/${action}`, 'PATCH', { stock_quantity: 0 })).status, 400);
  }
});
test('error middleware hides internal failures and malformed JSON contents', async t => {
  queries(t, () => { throw Error('secret password SQL and connection string'); });
  assert.deepEqual((await request('/api/products')).body, { success: false, message: 'Internal server error' });
  const response = await fetch(base + '/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{secret-invalid-json' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, message: 'Request body must contain valid JSON' });
});
