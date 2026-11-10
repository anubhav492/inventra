const MAX_ORDER_CENTS = 999999999999n; // Existing NUMERIC(12,2) column.
function toCents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Unexpected database monetary value');
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
}
function fromCents(value) { return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`; }
module.exports = { MAX_ORDER_CENTS, toCents, fromCents };
