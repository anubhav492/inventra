const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fixture = require('./helpers/sessionFixture')();
const app = fixture.app;
const pool = require('../src/config/db');

const USER = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const row = rows => ({ rows, rowCount: rows.length });
const product = { id: A, name: 'Mouse', sku: 'WM-001', price: '0.10', stock_quantity: 5, low_stock_threshold: 2, is_active: true };
const placed = { id: ORDER, status: 'placed', total_amount: '0.50', created_at: '2026-11-08T10:00:00Z', completed_at: null, cancelled_at: null };
const snapshot = { id: 'item-a', product_id: A, product_name: 'Original Mouse', sku: 'ORIGINAL', quantity: 3, unit_price: '0.10', line_total: '0.30' };
let server, base, cookie;
const env = { NODE_ENV: process.env.NODE_ENV, DEV_USER_ID: process.env.DEV_USER_ID };
before(async () => { server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
beforeEach(async t => {
  process.env.NODE_ENV = 'development'; process.env.DEV_USER_ID = '99999999-9999-4999-8999-999999999999';
  cookie = await fixture.cookie(USER);
  queries(t);
});
afterEach(() => { for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Origin: fixture.config.clientUrl, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
function queries(t, handler = () => { throw Error('Unexpected pool query'); }) {
  t.mock.method(pool, 'query', async (sql, values) => {
    if (sql === 'SELECT id, name, email FROM public.users WHERE id = $1') { assert.deepEqual(values, [USER]); return row([{ id: USER, name: 'Owner', email: 'owner@example.com' }]); }
    return handler(sql, values);
  });
}
function scenario(t, steps) {
  const calls = [], releases = [];
  queries(t);
  t.mock.method(pool, 'connect', async () => ({
    async query(sql, values) {
      calls.push({ sql, values });
      const step = steps.shift();
      assert.ok(step, `Unexpected transaction query: ${sql}`);
      assert.match(sql, step.match);
      step.check?.(values, sql);
      if (step.error) throw step.error;
      const result = row(step.rows || []);
      if (step.rowCount !== undefined) result.rowCount = step.rowCount;
      else if (/^\s*UPDATE/.test(sql)) result.rowCount = 1;
      return result;
    }, release(discard) { releases.push(discard); },
  }));
  t.after(() => { assert.equal(steps.length, 0, 'Every expected transaction statement should execute'); });
  return { calls, releases };
}
const begin = () => ({ match: /^BEGIN$/ });
const commit = () => ({ match: /^COMMIT$/ });
const rollback = () => ({ match: /^ROLLBACK$/ });
const lockProduct = rows => ({ match: /FROM products WHERE id = \$1 AND user_id = \$2 FOR UPDATE/, rows, check: values => assert.deepEqual(values, [A, USER]) });
const lockOrder = status => ({ match: /FROM orders WHERE id = \$1 AND user_id = \$2 FOR UPDATE/, rows: status ? [{ ...placed, status }] : [], check: values => assert.deepEqual(values, [ORDER, USER]) });
const lockProducts = rows => ({ match: /WHERE user_id = \$1 AND id = ANY\(\$2::uuid\[\]\) ORDER BY id FOR UPDATE/, rows });

test('all inventory/orders/dashboard endpoints reject anonymous sessions without business queries', async t => {
  cookie = undefined;
  process.env.NODE_ENV = 'production';
  t.mock.method(pool, 'query', () => { throw Error('Must not query'); });
  for (const path of ['/api/inventory', '/api/inventory/alerts', '/api/inventory/movements', '/api/orders', `/api/orders/${ORDER}`, '/api/dashboard/summary', '/api/dashboard/recent-orders', '/api/dashboard/low-stock', '/api/dashboard/revenue']) assert.equal((await request(path)).status, 401);
  for (const [path, method] of [[`/api/inventory/${A}/restock`, 'POST'], [`/api/inventory/${A}/adjust`, 'POST'], ['/api/orders', 'POST'], [`/api/orders/${ORDER}/complete`, 'PATCH'], [`/api/orders/${ORDER}/cancel`, 'PATCH']]) assert.equal((await request(path, method)).status, 401);
});
test('inventory list combines active ownership, status, escaped search and allowlisted sorting', async t => {
  queries(t, (sql, values) => { assert.match(sql, /p.user_id = \$1 AND p.is_active = true/); assert.match(sql, /stock_quantity > 0 AND p.stock_quantity <=/); assert.match(sql, /ORDER BY p.price DESC/); assert.deepEqual(values, [USER, '%WM\\_%']); return row([{ ...product, stock_status: 'low_stock' }]); });
  const response = await request('/api/inventory?status=low_stock&search=WM_&sortBy=price&sortOrder=desc');
  assert.equal(response.status, 200); assert.equal(response.body.data[0].price, '0.10');
});
test('inventory alerts and dashboard low stock order zero stock before low stock', async t => {
  queries(t, (sql, values) => { assert.equal(values[0], USER); assert.match(sql, /is_active = true AND p.stock_quantity <= p.low_stock_threshold/); assert.match(sql, /ORDER BY p.stock_quantity ASC/); return row([]); });
  assert.deepEqual((await request('/api/inventory/alerts')).body.data, []);
  assert.deepEqual((await request('/api/dashboard/low-stock')).body.data, []);
});
test('movement history joins product ownership and applies date/product/type pagination', async t => {
  queries(t, (sql, values) => {
    assert.match(sql, /m.user_id = \$1/); assert.equal(values[0], USER);
    if (sql.includes('COUNT(*)')) return row([{ total: '2' }]);
    assert.match(sql, /p.user_id = m.user_id/); assert.match(sql, /ORDER BY m.created_at DESC/); assert.match(sql, /Asia\/Kolkata/);
    assert.deepEqual(values, [USER, A, 'RESTOCK', '2026-11-01', '2026-11-08', 10, 10]); return row([]);
  });
  const response = await request(`/api/inventory/movements?productId=${A}&type=RESTOCK&startDate=2026-11-01&endDate=2026-11-08&page=2&limit=10`);
  assert.equal(response.status, 200); assert.deepEqual(response.body.pagination, { page: 2, limit: 10, total: '2' });
});
test('restock commits stock and history on one client with correct before/after values', async t => {
  const { releases } = scenario(t, [begin(), lockProduct([product]),
    { match: /UPDATE products SET stock_quantity/, rows: [{ ...product, stock_quantity: 25 }], check: values => assert.deepEqual(values, [25, A, USER]) },
    { match: /INSERT INTO stock_movements/, rows: [{ type: 'RESTOCK', previous_stock: 5, new_stock: 25, quantity_change: 20 }], check: values => assert.deepEqual(values, [USER, A, null, 'RESTOCK', 20, 5, 25, 'Supplier shipment']) }, commit()]);
  const response = await request(`/api/inventory/${A}/restock`, 'POST', { quantity: 20, reason: 'Supplier shipment' });
  assert.equal(response.status, 200); assert.equal(response.body.data.movement.new_stock, 25); assert.deepEqual(releases, [false]);
});
test('adjustment commits negative quantity change and correct history', async t => {
  scenario(t, [begin(), lockProduct([product]), { match: /UPDATE products/, rows: [{ ...product, stock_quantity: 2 }] },
    { match: /INSERT INTO stock_movements/, rows: [{ type: 'ADJUSTMENT' }], check: values => assert.deepEqual(values.slice(3), ['ADJUSTMENT', -3, 5, 2, 'Damaged inventory']) }, commit()]);
  assert.equal((await request(`/api/inventory/${A}/adjust`, 'POST', { quantity_change: -3, reason: 'Damaged inventory' })).status, 200);
});
test('negative final stock is rejected before any write and rolls back', async t => {
  const { calls } = scenario(t, [begin(), lockProduct([product]), rollback()]);
  assert.equal((await request(`/api/inventory/${A}/adjust`, 'POST', { quantity_change: -6, reason: 'Lost stock' })).status, 409);
  assert.ok(!calls.some(call => /^\s*(UPDATE|INSERT)\b/.test(call.sql)));
});
test('restocking archived products is rejected with rollback', async t => {
  scenario(t, [begin(), lockProduct([{ ...product, is_active: false }]), rollback()]);
  assert.equal((await request(`/api/inventory/${A}/restock`, 'POST', { quantity: 1 })).status, 409);
});
test('stock overflow is rejected before update', async t => {
  scenario(t, [begin(), lockProduct([{ ...product, stock_quantity: 2147483647 }]), rollback()]);
  assert.equal((await request(`/api/inventory/${A}/restock`, 'POST', { quantity: 1 })).status, 409);
});
test('inaccessible stock products return 404, and movement failure rolls back', async t => {
  scenario(t, [begin(), lockProduct([]), rollback()]);
  assert.equal((await request(`/api/inventory/${A}/restock`, 'POST', { quantity: 1 })).status, 404);
});
test('movement insertion failure rolls back stock update and releases client', async t => {
  const { calls, releases } = scenario(t, [begin(), lockProduct([product]), { match: /UPDATE products/, rows: [product] }, { match: /INSERT INTO stock_movements/, error: Error('private SQL detail') }, rollback()]);
  const response = await request(`/api/inventory/${A}/restock`, 'POST', { quantity: 1 });
  assert.equal(response.status, 500); assert.ok(!JSON.stringify(response.body).includes('private SQL')); assert.deepEqual(releases, [false]); assert.ok(!calls.some(call => call.sql === 'COMMIT'));
});
test('orders list scopes counts/items and supports filtering, dates and sorting', async t => {
  queries(t, (sql, values) => { assert.equal(values[0], USER); assert.match(sql, /o.user_id = \$1/); if (sql.includes('AS total FROM')) return row([{ total: '1' }]); assert.match(sql, /i.user_id = o.user_id/); assert.match(sql, /ORDER BY o.total_amount ASC/); return row([{ ...placed, item_count: 2 }]); });
  assert.equal((await request('/api/orders?status=placed&search=4444&startDate=2026-11-01&sortBy=total_amount&sortOrder=asc')).body.data[0].item_count, 2);
});
test('order details use snapshot fields and exact decimal JSON strings', async t => {
  queries(t, (sql, values) => { assert.deepEqual(values, [ORDER, USER]); assert.match(sql, /i.user_id = o.user_id/); assert.match(sql, /i.unit_price::text/); assert.match(sql, /o.user_id = \$2/); return row([{ ...placed, items: [snapshot] }]); });
  const response = await request(`/api/orders/${ORDER}`);
  assert.equal(response.status, 200); assert.equal(response.body.data.items[0].product_name, 'Original Mouse');
});
test('missing/inaccessible order details return 404', async t => { queries(t, () => row([])); assert.equal((await request(`/api/orders/${ORDER}`)).status, 404); });
test('multi-product creation locks sorted IDs and commits exact totals, snapshots and all deductions', async t => {
  const steps = [begin(), lockProducts([product, { ...product, id: B, price: '0.20', stock_quantity: 2 }]),
    { match: /INSERT INTO orders/, rows: [placed], check: values => assert.deepEqual(values, [USER, '0.50']) }];
  for (const [id, quantity, price, previous, nextStock] of [[A, 3, '0.10', 5, 2], [B, 1, '0.20', 2, 1]]) {
    steps.push({ match: /INSERT INTO order_items/, rows: [{ ...snapshot, product_id: id, quantity, unit_price: price }], check: values => assert.deepEqual(values, [ORDER, USER, id, 'Mouse', 'WM-001', quantity, price]) },
      { match: /UPDATE products/, check: values => assert.deepEqual(values, [nextStock, id, USER]) },
      { match: /INSERT INTO stock_movements/, check: values => assert.deepEqual(values, [USER, id, ORDER, 'ORDER_PLACED', -quantity, previous, nextStock, 'Order placed']) });
  }
  steps.push(commit());
  steps[1].check = values => assert.deepEqual(values, [USER, [A, B]]);
  const { releases } = scenario(t, steps);
  const response = await request('/api/orders', 'POST', { items: [{ product_id: B, quantity: 1 }, { product_id: A, quantity: 3 }] });
  assert.equal(response.status, 201); assert.equal(response.body.data.total_amount, '0.50'); assert.equal(response.body.data.items.length, 2); assert.deepEqual(releases, [false]);
});
test('insufficient stock rejects whole order before any order/item/product writes', async t => {
  const { calls } = scenario(t, [begin(), lockProducts([product]), rollback()]);
  assert.equal((await request('/api/orders', 'POST', { items: [{ product_id: A, quantity: 6 }] })).status, 409);
  assert.ok(!calls.some(call => /^\s*(INSERT|UPDATE)\b/.test(call.sql)));
});
test('order creation rejects missing products without exposing ownership', async t => {
  scenario(t, [begin(), lockProducts([]), rollback()]);
  assert.equal((await request('/api/orders', 'POST', { items: [{ product_id: A, quantity: 1 }] })).status, 404);
});
test('order creation rejects archived products', async t => {
  scenario(t, [begin(), lockProducts([{ ...product, is_active: false }]), rollback()]);
  assert.equal((await request('/api/orders', 'POST', { items: [{ product_id: A, quantity: 1 }] })).status, 409);
});
test('order total overflow is rejected using exact arithmetic before insertion', async t => {
  scenario(t, [begin(), lockProducts([{ ...product, price: '9999999999.99' }]), rollback()]);
  assert.equal((await request('/api/orders', 'POST', { items: [{ product_id: A, quantity: 2 }] })).status, 409);
});
test('completion locks order, updates only status/timestamp, and makes no stock movements', async t => {
  const { calls } = scenario(t, [begin(), lockOrder('placed'), { match: /UPDATE orders SET status = 'completed'/, rows: [{ ...placed, status: 'completed' }] }, { match: /FROM order_items WHERE order_id = \$1 AND user_id = \$2/, rows: [snapshot] }, commit()]);
  assert.equal((await request(`/api/orders/${ORDER}/complete`, 'PATCH')).body.data.status, 'completed');
  assert.ok(!calls.some(call => /UPDATE products|INSERT INTO stock_movements/.test(call.sql)));
});
test('cancellation restores archived products and records order-linked positive movements once', async t => {
  const { calls } = scenario(t, [begin(), lockOrder('placed'), { match: /FROM order_items/, rows: [snapshot] }, lockProducts([{ id: A, stock_quantity: 2, is_active: false }]),
    { match: /UPDATE products/, check: values => assert.deepEqual(values, [5, A, USER]) },
    { match: /INSERT INTO stock_movements/, check: values => assert.deepEqual(values, [USER, A, ORDER, 'ORDER_CANCELLED', 3, 2, 5, 'Order cancelled']) },
    { match: /UPDATE orders SET status = 'cancelled'/, rows: [{ ...placed, status: 'cancelled' }] }, commit()]);
  assert.equal((await request(`/api/orders/${ORDER}/cancel`, 'PATCH')).status, 200);
  assert.ok(!calls.some(call => /SET is_active/.test(call.sql)));
});
test('already cancelled order is rejected before stock reads or restoration', async t => {
  const { calls } = scenario(t, [begin(), lockOrder('cancelled'), rollback()]);
  assert.equal((await request(`/api/orders/${ORDER}/cancel`, 'PATCH')).status, 409);
  assert.ok(!calls.some(call => /FROM products|UPDATE products/.test(call.sql)));
});
test('completed orders cannot be cancelled', async t => {
  scenario(t, [begin(), lockOrder('completed'), rollback()]);
  assert.equal((await request(`/api/orders/${ORDER}/cancel`, 'PATCH')).status, 409);
});
test('cancellation restoration overflow rejects every change', async t => {
  const { calls } = scenario(t, [begin(), lockOrder('placed'), { match: /FROM order_items/, rows: [snapshot] }, lockProducts([{ id: A, stock_quantity: 2147483647 }]), rollback()]);
  assert.equal((await request(`/api/orders/${ORDER}/cancel`, 'PATCH')).status, 409);
  assert.ok(!calls.some(call => /^\s*(UPDATE|INSERT)\b/.test(call.sql)));
});
test('dashboard summary uses independent aggregates, completed revenue and owner scope', async t => {
  queries(t, (sql, values) => { assert.deepEqual(values, [USER]); assert.match(sql, /FROM products WHERE user_id = \$1 AND is_active = true/); assert.match(sql, /FROM orders WHERE user_id = \$1/); assert.match(sql, /SUM\(total_amount\) FILTER \(WHERE status = 'completed'\)/); assert.match(sql, /CROSS JOIN sales/); return row([{ total_revenue: '0.00', total_orders: 0 }]); });
  assert.equal((await request('/api/dashboard/summary')).body.data.total_revenue, '0.00');
});
test('dashboard recent orders is scoped, bounded and counts owned items', async t => {
  queries(t, (sql, values) => { assert.deepEqual(values, [USER, 10]); assert.match(sql, /i.user_id = o.user_id/); assert.match(sql, /ORDER BY o.created_at DESC/); return row([]); });
  assert.equal((await request('/api/dashboard/recent-orders?limit=10')).status, 200);
});
test('revenue query zero-fills dates and groups completed amounts by IST completion date', async t => {
  const spans = [];
  queries(t, (sql, values) => { spans.push(values[1]); assert.equal(values[0], USER); assert.match(sql, /generate_series/); assert.match(sql, /status = 'completed'/); assert.match(sql, /completed_at AT TIME ZONE 'Asia\/Kolkata'/); assert.match(sql, /COALESCE\(t.revenue, 0.00\)/); assert.match(sql, /ORDER BY d.date/); return row([{ date: '2026-11-08', revenue: '0.00' }]); });
  for (const period of ['', '?period=7d', '?period=30d', '?period=90d']) assert.equal((await request('/api/dashboard/revenue' + period)).status, 200);
  assert.deepEqual(spans, [30, 7, 30, 90]);
});
test('invalid query/body/UUID and spoofed identity fail before transaction acquisition', async t => {
  queries(t);
  t.mock.method(pool, 'connect', () => { throw Error('Must not acquire a transaction'); });
  for (const path of ['/api/inventory?sortBy=constructor', '/api/inventory?status=archived', '/api/inventory?search=a&search=b', '/api/inventory?user_id=x', '/api/inventory/movements?productId=invalid', '/api/inventory/movements?type=invalid', '/api/inventory/movements?limit=101', '/api/orders?sortBy=DROP', '/api/orders?status=unknown', '/api/orders?startDate=2026-02-30', `/api/orders/not-a-uuid`, '/api/dashboard/revenue?period=1d', '/api/dashboard/summary?user_id=x', '/api/dashboard/recent-orders?limit=11']) assert.equal((await request(path)).status, 400, path);
  for (const [path, method, body] of [[`/api/inventory/${A}/restock`, 'POST', { quantity: 0 }], [`/api/inventory/${A}/adjust`, 'POST', { quantity_change: 0, reason: 'Invalid' }], [`/api/inventory/${A}/restock`, 'POST', { quantity: 1, user_id: USER }], ['/api/orders', 'POST', { items: [] }], ['/api/orders', 'POST', { items: [{ product_id: A, quantity: 1, unit_price: 1 }] }], [`/api/orders/${ORDER}/cancel`, 'PATCH', { status: 'cancelled' }]]) assert.equal((await request(path, method, body)).status, 400);
});
test('transaction acquisition errors produce safe 503 responses', async t => {
  queries(t);
  t.mock.method(pool, 'connect', async () => { throw Object.assign(Error('private URL'), { code: 'ECONNRESET' }); });
  const response = await request(`/api/inventory/${A}/restock`, 'POST', { quantity: 1 });
  assert.deepEqual(response, { status: 503, body: { success: false, message: 'Database temporarily unavailable' } });
});
test('database serialization conflicts return safe retryable 409', async t => {
  scenario(t, [begin(), { match: /FOR UPDATE/, error: Object.assign(Error('private SQL'), { code: '40001' }) }, rollback()]);
  const response = await request(`/api/inventory/${A}/restock`, 'POST', { quantity: 1 });
  assert.equal(response.status, 409); assert.match(response.body.message, /retry/i); assert.ok(!response.body.message.includes('private'));
});
test('partial order creation failure rolls back the order and items and releases the client', async t => {
  const { calls, releases } = scenario(t, [begin(), lockProducts([product]),
    { match: /INSERT INTO orders/, rows: [placed] }, { match: /INSERT INTO order_items/, rows: [snapshot] },
    { match: /UPDATE products/ }, { match: /INSERT INTO stock_movements/, error: Error('private failure') }, rollback()]);
  const response = await request('/api/orders', 'POST', { items: [{ product_id: A, quantity: 1 }] });
  assert.equal(response.status, 500); assert.deepEqual(releases, [false]); assert.ok(!calls.some(call => call.sql === 'COMMIT'));
});
test('cancellation movement failure rolls back restoration before status can change', async t => {
  const { calls } = scenario(t, [begin(), lockOrder('placed'), { match: /FROM order_items/, rows: [snapshot] }, lockProducts([{ id: A, stock_quantity: 2 }]),
    { match: /UPDATE products/ }, { match: /INSERT INTO stock_movements/, error: Error('movement failed') }, rollback()]);
  assert.equal((await request(`/api/orders/${ORDER}/cancel`, 'PATCH')).status, 500);
  assert.ok(!calls.some(call => /UPDATE orders/.test(call.sql)));
});
test('zero-row stock update never commits a misleading movement', async t => {
  const { calls } = scenario(t, [begin(), lockProduct([product]), { match: /UPDATE products/, rowCount: 0 }, rollback()]);
  assert.equal((await request(`/api/inventory/${A}/restock`, 'POST', { quantity: 1 })).status, 409);
  assert.ok(!calls.some(call => /INSERT INTO stock_movements/.test(call.sql)));
});
test('unusable transaction clients are discarded when rollback fails', async t => {
  const { releases } = scenario(t, [begin(), { match: /FOR UPDATE/, error: Object.assign(Error('broken connection'), { code: 'ECONNRESET' }) }, { match: /^ROLLBACK$/, error: Error('rollback failed') }]);
  assert.equal((await request(`/api/inventory/${A}/restock`, 'POST', { quantity: 1 })).status, 503);
  assert.deepEqual(releases, [true]);
});
test('inaccessible orders cannot be cancelled and completed orders cannot be completed again', async t => {
  scenario(t, [begin(), lockOrder(null), rollback(), begin(), lockOrder('completed'), rollback()]);
  assert.equal((await request(`/api/orders/${ORDER}/cancel`, 'PATCH')).status, 404);
  assert.equal((await request(`/api/orders/${ORDER}/complete`, 'PATCH')).status, 409);
});
