const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/utils/apiValidation');
const money = require('../src/utils/money');
const { validateItems } = require('../src/controllers/orderController');

const ID = 'aaaaaaaa-1111-4111-8111-111111111111';
test('order items reject unsupported fields, duplicates including UUID case, and invalid quantities', () => {
  for (const body of [{}, { items: [] }, { items: [null] }, { items: [{ product_id: ID, quantity: 1, price: '1.00' }] }, { items: [{ product_id: ID, quantity: 1 }, { product_id: ID.toUpperCase(), quantity: 2 }] }, { items: [{ product_id: 'bad', quantity: 1 }] }, { items: [{ product_id: ID, quantity: '1' }] }, { items: [{ product_id: ID, quantity: 0 }] }, { items: [{ product_id: ID, quantity: 1.5 }] }, { items: [{ product_id: ID, quantity: 1 }], user_id: ID }]) {
    assert.throws(() => validateItems(body), { status: 400 });
  }
  assert.deepEqual(validateItems({ items: [{ product_id: ID.toUpperCase(), quantity: 1 }] }), [{ product_id: ID, quantity: 1 }]);
});
test('exact money calculations use BigInt paise, not floating point', () => {
  assert.equal(money.fromCents(money.toCents('0.10') * 3n + money.toCents('0.20')), '0.50');
  assert.equal(money.toCents('9999999999.99'), money.MAX_ORDER_CENTS);
  assert.equal(money.fromCents(0n), '0.00');
  assert.throws(() => money.toCents('1.001'));
});
test('inventory changes validate signed/positive integers and prevent overflow/negative stock', () => {
  assert.equal(v.signedInteger(-3), -3);
  for (const value of [0, '1', 1.5, null, 2147483648, -2147483649]) assert.throws(() => v.signedInteger(value), { status: 400 });
  for (const value of [0, -1, '2', 2.5, 2147483648]) assert.throws(() => v.positiveInteger(value, 'quantity'), { status: 400 });
  assert.throws(() => v.checkedStock(-1), { status: 409 });
  assert.throws(() => v.checkedStock(2147483648), { status: 409 });
  for (const reason of ['', ' ', 'ab', null, 'x'.repeat(501), 'a\0b']) assert.throws(() => v.reason(reason, true), { status: 400 });
});
test('pagination is bounded and dates reject impossible/reversed calendar ranges', () => {
  assert.deepEqual(v.pagination({}), { page: 1, limit: 20, offset: 0 });
  assert.deepEqual(v.pagination({ page: '2', limit: '100' }), { page: 2, limit: 100, offset: 100 });
  for (const query of [{ page: '0' }, { limit: '101' }, { page: '1.5' }, { page: '1000001' }, { limit: '-1' }]) assert.throws(() => v.pagination(query), { status: 400 });
  for (const query of [{ startDate: '2026-02-30' }, { startDate: 'invalid' }, { startDate: '2026-12-01', endDate: '2026-11-01' }, { endDate: '0000-01-01' }]) assert.throws(() => v.dates([], [], query, 'created_at'), { status: 400 });
  const conditions = [], values = [];
  v.dates(conditions, values, { startDate: '2024-02-29', endDate: '2024-02-29' }, 'created_at');
  assert.deepEqual(values, ['2024-02-29', '2024-02-29']);
  assert.ok(conditions.every(condition => condition.includes('Asia/Kolkata')));
});
