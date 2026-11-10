const { badRequest, validateUuid, validateText, rejectUnsupportedFields } = require('./productValidation');
const PG_INTEGER_MAX = 2147483647;
const MOVEMENT_TYPES = ['INITIAL_STOCK', 'RESTOCK', 'ADJUSTMENT', 'ORDER_PLACED', 'ORDER_CANCELLED'];

function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function bodyFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Request body must be a JSON object');
  rejectUnsupportedFields(body, allowed);
}
function emptyBody(req) {
  if (req.body === undefined && !req.headers['transfer-encoding'] && !(Number(req.headers['content-length']) > 0)) return;
  bodyFields(req.body, []);
}
function queryFields(query, allowed) {
  rejectUnsupportedFields(query, allowed);
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string' || value.includes('\0')) badRequest(`${key} must be a single valid string`);
  }
}
function choice(value, allowed, label) {
  if (!allowed.includes(value)) badRequest(`${label} must be one of: ${allowed.join(', ')}`);
  return value;
}
function uuid(value, label) { validateUuid(value, label); return value.toLowerCase(); }
function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > PG_INTEGER_MAX) badRequest(`${label} must be an integer from 1 to ${PG_INTEGER_MAX}`);
  return value;
}
function signedInteger(value) {
  if (!Number.isInteger(value) || value === 0 || value < -2147483648 || value > PG_INTEGER_MAX) badRequest('quantity_change must be a nonzero PostgreSQL integer');
  return value;
}
function reason(value, required) {
  if (value === undefined && !required) return 'Stock replenishment';
  const text = validateText(value, 'reason', 500);
  if (text.includes('\0') || (required && text.length < 3)) badRequest('reason must contain 3–500 meaningful characters');
  return text;
}
function checkedStock(quantity) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > PG_INTEGER_MAX) throw httpError(409, 'Stock change would result in negative inventory or integer overflow');
  return quantity;
}
function pageInteger(value, fallback, max, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) badRequest(`${label} must be an integer from 1 to ${max}`);
  return Number(value);
}
function pagination(query) {
  const page = pageInteger(query.page, 1, 1000000, 'page');
  const limit = pageInteger(query.limit, 20, 100, 'limit');
  return { page, limit, offset: (page - 1) * limit };
}
function dates(conditions, values, query, column) {
  for (const key of ['startDate', 'endDate']) {
    if (query[key] === undefined) continue;
    const value = query[key];
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(NaN);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '0001-01-01') badRequest(`${key} must be a real calendar date in YYYY-MM-DD format`);
  }
  if (query.startDate && query.endDate && query.startDate > query.endDate) badRequest('startDate must not be after endDate');
  if (query.startDate) {
    values.push(query.startDate);
    conditions.push(`${column} >= ($${values.length}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`);
  }
  if (query.endDate) {
    values.push(query.endDate);
    conditions.push(`${column} < (($${values.length}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`);
  }
}
const searchPattern = value => `%${value.trim().replace(/[\\%_]/g, '\\$&')}%`;

module.exports = { PG_INTEGER_MAX, MOVEMENT_TYPES, httpError, bodyFields, emptyBody, queryFields, choice, uuid, positiveInteger, signedInteger, reason, checkedStock, pageInteger, pagination, dates, searchPattern };
