const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fixture = require('./helpers/sessionFixture')();
const pool = require('../src/config/db');

const A = '11111111-1111-4111-8111-111111111111';
const B = '99999999-9999-4999-8999-999999999999';
const PA = '22222222-2222-4222-8222-222222222222';
const PB = '33333333-3333-4333-8333-333333333333';
const OA = '44444444-4444-4444-8444-444444444444';
const OB = '55555555-5555-4555-8555-555555555555';
const MISSING = '00000000-0000-4000-8000-000000000000';
const users = new Map([[A, { id: A, name: 'Alice', email: 'alice@example.com' }], [B, { id: B, name: 'Bob', email: 'bob@example.com' }]]);
const products = [{ id: PA, user_id: A, name: 'Alice product', sku: 'A', price: '3.00', stock_quantity: 10, low_stock_threshold: 15, is_active: true }, { id: PB, user_id: B, name: 'Bob product', sku: 'B', price: '7.00', stock_quantity: 20, low_stock_threshold: 25, is_active: true }];
const orders = [{ id: OA, user_id: A, status: 'placed', total_amount: '3.00' }, { id: OB, user_id: B, status: 'placed', total_amount: '7.00' }];
const row = rows => ({ rows, rowCount: rows.length });
const publicProduct = ({ user_id, ...product }) => product;
let server, base, cookies;

before(async () => {
  server = http.createServer(fixture.app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
beforeEach(async t => {
  users.set(A, { id: A, name: 'Alice', email: 'alice@example.com' });
  users.set(B, { id: B, name: 'Bob', email: 'bob@example.com' });
  fixture.store.clear();
  cookies = { [A]: await fixture.cookie(A), [B]: await fixture.cookie(B) };
  queries(t);
  t.mock.method(pool, 'connect', async () => { throw Error('Unexpected database connection'); });
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });

function queries(t, handler = () => { throw Error('Unexpected business query'); }) {
  t.mock.method(pool, 'query', async (sql, values) => {
    if (sql === 'SELECT id, name, email FROM public.users WHERE id = $1') return row(users.has(values[0]) ? [users.get(values[0])] : []);
    return handler(sql, values);
  });
}
async function request(path, { user = A, cookie = cookies[user], method = 'GET', body, origin = fixture.config.clientUrl, headers = {} } = {}) {
  const response = await fetch(base + path, { method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

const endpoints = [
  ['/products'], [`/products/${PA}`], ['/products', 'POST', { name: 'New', sku: 'N', price: '1.00' }],
  [`/products/${PA}`, 'PATCH', { name: 'Edited' }], [`/products/${PA}/archive`, 'PATCH'], [`/products/${PA}/restore`, 'PATCH'],
  ['/inventory'], ['/inventory/alerts'], ['/inventory/movements'],
  [`/inventory/${PA}/restock`, 'POST', { quantity: 1 }], [`/inventory/${PA}/adjust`, 'POST', { quantity_change: -1, reason: 'Damage' }],
  ['/orders'], [`/orders/${OA}`], ['/orders', 'POST', { items: [{ product_id: PA, quantity: 1 }] }],
  [`/orders/${OA}/complete`, 'PATCH'], [`/orders/${OA}/cancel`, 'PATCH'],
  ['/dashboard/summary'], ['/dashboard/recent-orders'], ['/dashboard/low-stock'], ['/dashboard/revenue'],
];

test('every business endpoint rejects missing, tampered, expired and deleted-user sessions with 401', async t => {
  const expired = await fixture.cookie(A, { authenticatedAt: Date.now() - fixture.config.maxAge - 1 });
  const deleted = await fixture.cookie(MISSING);
  t.mock.method(pool, 'query', async (sql, values) => {
    assert.equal(sql, 'SELECT id, name, email FROM public.users WHERE id = $1');
    assert.deepEqual(values, [MISSING]);
    return row([]);
  });
  for (const cookie of ['', 'inventra.sid=s%3Atampered.invalid', expired, deleted]) {
    for (const [path, method = 'GET', body] of endpoints) {
      const response = await request(path, { cookie, method, body, origin: null });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.deepEqual(response.body, { success: false, message: 'Authentication required' });
    }
  }
});

test('authenticated business writes require exact Origin before any business SQL', async () => {
  for (const origin of [null, 'null', 'https://evil.example']) {
    for (const [path, method, body] of endpoints.filter(([, method]) => method)) {
      assert.equal((await request(path, { method, body, origin })).status, 403);
    }
  }
});

test('both users see only their products, inventory, movements, orders and dashboard aggregates', async t => {
  let expectedUser;
  queries(t, (sql, values) => {
    assert.equal(values[0], expectedUser);
    assert.match(sql, /(?:\w+\.)?user_id = \$1/);
    const ownedProducts = products.filter(product => product.user_id === values[0]);
    const ownedOrders = orders.filter(order => order.user_id === values[0]);
    if (sql.includes('stock_movements m')) {
      if (sql.includes('COUNT(*)')) return row([{ total: '1' }]);
      assert.match(sql, /p.id = m.product_id AND p.user_id = m.user_id/);
      return row([{ product_id: ownedProducts[0].id, type: 'RESTOCK' }]);
    }
    if (sql.includes('WITH inventory')) {
      assert.match(sql, /FROM products WHERE user_id = \$1/);
      assert.match(sql, /FROM orders WHERE user_id = \$1/);
      return row([{ total_stock_units: ownedProducts[0].stock_quantity, total_revenue: ownedOrders[0].total_amount }]);
    }
    if (sql.includes('WITH bounds')) {
      assert.match(sql, /FROM orders, bounds WHERE user_id = \$1 AND status = 'completed'/);
      return row([{ date: '2026-11-08', revenue: ownedOrders[0].total_amount }]);
    }
    if (sql.includes('FROM orders o')) {
      if (sql.startsWith('SELECT COUNT(*)')) return row([{ total: '1' }]);
      assert.match(sql, /i.order_id = o.id AND i.user_id = o.user_id/);
      return row(ownedOrders.map(({ user_id, ...order }) => order));
    }
    return row(ownedProducts.map(publicProduct));
  });
  for (const user of [A, B]) {
    expectedUser = user;
    const otherProduct = user === A ? PB : PA;
    const otherOrder = user === A ? OB : OA;
    for (const path of ['/products', '/inventory', '/inventory/alerts', '/inventory/movements', '/orders', '/dashboard/recent-orders', '/dashboard/low-stock']) {
      const response = await request(path, { user, headers: { 'X-User-Id': user === A ? B : A } });
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(JSON.stringify(response.body).includes(otherProduct), false);
      assert.equal(JSON.stringify(response.body).includes(otherOrder), false);
      assert.equal(response.body.count, 1);
    }
    assert.equal((await request('/dashboard/summary', { user })).body.data.total_stock_units, user === A ? 10 : 20);
    assert.equal((await request('/dashboard/revenue', { user })).body.data[0].revenue, user === A ? '3.00' : '7.00');
  }
});

test('foreign product IDs and order IDs behave exactly like missing resources on reads and mutations', async t => {
  let expectedUser;
  const statements = [];
  queries(t, (sql, values) => {
    statements.push(sql);
    assert.match(sql, /(?:\w+\.)?user_id = \$\d+/);
    assert.equal(values[sql.includes('SET is_active') ? 2 : values.length - 1], expectedUser);
    if (sql.includes('LEFT JOIN order_items')) assert.match(sql, /i.user_id = o.user_id/);
    return row([]);
  });
  t.mock.method(pool, 'connect', async () => ({
    async query(sql, values) {
      statements.push(sql);
      if (['BEGIN', 'ROLLBACK'].includes(sql)) return row([]);
      assert.match(sql, /WHERE id = \$1 AND user_id = \$2 FOR UPDATE/);
      assert.equal(values[1], expectedUser);
      return row([]);
    }, release() {},
  }));
  for (const user of [A, B]) {
    expectedUser = user;
    const foreignProduct = user === A ? PB : PA, foreignOrder = user === A ? OB : OA;
    for (const [method, path, body] of [
      ['GET', '/products/ID'], ['PATCH', '/products/ID', { name: 'Overwrite' }],
      ['PATCH', '/products/ID/archive'], ['PATCH', '/products/ID/restore'],
      ['POST', '/inventory/ID/restock', { quantity: 1 }], ['POST', '/inventory/ID/adjust', { quantity_change: -1, reason: 'Damage' }],
      ['GET', '/orders/ID'], ['PATCH', '/orders/ID/complete'], ['PATCH', '/orders/ID/cancel'],
    ]) {
      const foreignId = path.startsWith('/orders') ? foreignOrder : foreignProduct;
      const foreign = await request(path.replace('ID', foreignId), { user, method, body });
      const missing = await request(path.replace('ID', MISSING), { user, method, body });
      assert.equal(foreign.status, 404, path);
      assert.deepEqual(foreign.body, missing.body);
      assert.equal(missing.status, 404);
    }
  }
  assert.ok(!statements.some(sql => /INSERT|COMMIT/.test(sql)));
});

test('movement filtering by another user product returns empty data and zero count', async t => {
  queries(t, (sql, values) => {
    assert.match(sql, /m.user_id = \$1 AND m.product_id = \$2/);
    assert.deepEqual(values.slice(0, 2), [A, PB]);
    if (!sql.includes('COUNT(*)')) assert.match(sql, /p.user_id = m.user_id/);
    return row(sql.includes('COUNT(*)') ? [{ total: '0' }] : []);
  });
  const response = await request(`/inventory/movements?productId=${PB}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
  assert.equal(response.body.pagination.total, '0');
});

test('mixed-owner order creation rolls back before inserting orders/items or changing any stock', async t => {
  let expectedUser;
  const statements = [];
  t.mock.method(pool, 'connect', async () => ({
    async query(sql, values) {
      statements.push(sql);
      if (['BEGIN', 'ROLLBACK'].includes(sql)) return row([]);
      assert.match(sql, /WHERE user_id = \$1 AND id = ANY\(\$2::uuid\[\]\) ORDER BY id FOR UPDATE/);
      assert.equal(values[0], expectedUser);
      return row(products.filter(product => product.user_id === values[0] && values[1].includes(product.id)));
    }, release() {},
  }));
  for (const user of [A, B]) {
    expectedUser = user;
    const response = await request('/orders', { user, method: 'POST', body: { items: [{ product_id: PA, quantity: 1 }, { product_id: PB, quantity: 1 }] } });
    assert.equal(response.status, 404);
    assert.equal(response.body.message, 'One or more products were not found');
  }
  assert.equal(statements.filter(sql => sql === 'ROLLBACK').length, 2);
  assert.ok(!statements.some(sql => /INSERT|UPDATE products|COMMIT/.test(sql)));
});

test('each users successful order transactions scope locks, snapshots, stock writes and movements to that session', async t => {
  let expectedUser;
  const movements = [];
  t.mock.method(pool, 'connect', async () => ({
    async query(sql, values) {
      if (['BEGIN', 'COMMIT'].includes(sql)) return row([]);
      const product = products.find(product => product.user_id === expectedUser);
      const order = orders.find(order => order.user_id === expectedUser);
      const item = { id: 'item', product_id: product.id, product_name: product.name, sku: product.sku, quantity: 1, unit_price: product.price };
      if (sql.includes('FROM orders WHERE')) {
        assert.match(sql, /WHERE id = \$1 AND user_id = \$2 FOR UPDATE/);
        assert.deepEqual(values, [order.id, expectedUser]);
        return row([order]);
      }
      if (sql.includes('FROM products')) {
        assert.match(sql, /WHERE user_id = \$1 AND id = ANY\(\$2::uuid\[\]\) ORDER BY id FOR UPDATE/);
        assert.deepEqual(values, [expectedUser, [product.id]]);
        return row([product]);
      }
      if (sql.includes('FROM order_items')) {
        assert.match(sql, /WHERE order_id = \$1 AND user_id = \$2/);
        assert.deepEqual(values, [order.id, expectedUser]);
        return row([item]);
      }
      if (sql.startsWith('INSERT INTO orders')) {
        assert.deepEqual(values, [expectedUser, product.price]);
        return row([order]);
      }
      if (sql.startsWith('INSERT INTO order_items')) {
        assert.match(sql, /\(order_id, user_id, product_id,/);
        assert.deepEqual(values.slice(0, 3), [order.id, expectedUser, product.id]);
        return row([item]);
      }
      if (sql.startsWith('UPDATE products')) {
        assert.match(sql, /WHERE id = \$2 AND user_id = \$3/);
        assert.deepEqual(values.slice(1), [product.id, expectedUser]);
        return row([publicProduct(product)]);
      }
      if (sql.startsWith('INSERT INTO stock_movements')) {
        assert.match(sql, /\(user_id, product_id, order_id,/);
        assert.deepEqual(values.slice(0, 3), [expectedUser, product.id, order.id]);
        movements.push(values);
        return row([{ type: values[3] }]);
      }
      if (sql.startsWith('UPDATE orders')) {
        assert.match(sql, /WHERE id = \$1 AND user_id = \$2/);
        assert.deepEqual(values, [order.id, expectedUser]);
        return row([{ ...order, status: sql.includes("'completed'") ? 'completed' : 'cancelled' }]);
      }
      assert.fail(`Unexpected transaction SQL: ${sql}`);
    }, release() {},
  }));
  for (const user of [A, B]) {
    expectedUser = user;
    const product = products.find(product => product.user_id === user), order = orders.find(order => order.user_id === user);
    assert.equal((await request('/orders', { user, method: 'POST', body: { items: [{ product_id: product.id, quantity: 1 }] } })).status, 201);
    assert.equal((await request(`/orders/${order.id}/complete`, { user, method: 'PATCH' })).status, 200);
    assert.equal((await request(`/orders/${order.id}/cancel`, { user, method: 'PATCH' })).status, 200);
  }
  assert.deepEqual(movements.map(values => [values[0], values[3]]), [[A, 'ORDER_PLACED'], [A, 'ORDER_CANCELLED'], [B, 'ORDER_PLACED'], [B, 'ORDER_CANCELLED']]);
});
