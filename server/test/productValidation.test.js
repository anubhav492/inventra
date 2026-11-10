const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUuid, validateText, validatePrice, validateInteger } = require('../src/utils/productValidation');

test('UUID validation accepts canonical UUIDs including version 7 and rejects malformed IDs', () => {
  for (const value of ['12345678-1234-4234-8234-123456789abc', '019a681d-0000-7000-8000-123456789abc']) assert.doesNotThrow(() => validateUuid(value));
  for (const value of [null, '', 'product-uuid', '12345678', ['12345678-1234-4234-8234-123456789abc']]) assert.throws(() => validateUuid(value), { status: 400 });
});
test('text validation trims and enforces required names and length limits', () => {
  assert.equal(validateText('  Wireless Mouse  ', 'name', 150), 'Wireless Mouse');
  assert.equal(validateText('A'.repeat(150), 'name', 150).length, 150);
  for (const value of [undefined, null, '', ' ', 12, 'A'.repeat(151)]) assert.throws(() => validateText(value, 'name', 150), { status: 400 });
});
test('NUMERIC(12,2) validation preserves exact decimal strings', () => {
  for (const [input, expected] of [[799, '799.00'], ['00001.20', '1.20'], ['9999999999.99', '9999999999.99'], [0, '0.00'], ['0.01', '0.01']]) assert.equal(validatePrice(input), expected);
  for (const value of [-1, '-0.01', '1.234', '10000000000', '1e2', '', ' ', true, null, undefined, Infinity, NaN, {}, []]) assert.throws(() => validatePrice(value), { status: 400 });
});
test('integer validation respects PostgreSQL INTEGER range and defaults', () => {
  assert.equal(validateInteger(undefined, 'stock_quantity', 0), 0);
  assert.equal(validateInteger(undefined, 'low_stock_threshold', 5), 5);
  assert.equal(validateInteger(2147483647, 'stock_quantity'), 2147483647);
  for (const value of [undefined, null, '1', -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER, Infinity]) assert.throws(() => validateInteger(value, 'stock_quantity'), { status: 400 });
});
