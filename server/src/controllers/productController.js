const pool = require('../config/db');
const { badRequest, validateUuid, validateText, validatePrice, validateInteger, rejectUnsupportedFields } = require('../utils/productValidation');

const PRODUCT_COLUMNS = 'id, name, sku, price, stock_quantity, low_stock_threshold, is_active, created_at';
const sortColumns = { name: 'name', price: 'price', stock_quantity: 'stock_quantity', created_at: 'created_at' };
const statusConditions = {
  all: '', active: 'is_active = true', archived: 'is_active = false',
  in_stock: 'is_active = true AND stock_quantity > low_stock_threshold',
  low_stock: 'is_active = true AND stock_quantity > 0 AND stock_quantity <= low_stock_threshold',
  out_of_stock: 'is_active = true AND stock_quantity = 0',
};
function jsonBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Request body must be a JSON object');
}
function missing(res) { return res.status(404).json({ success: false, message: 'Product not found' }); }

async function getProducts(req, res, next) {
  try {
    rejectUnsupportedFields(req.query, ['search', 'status', 'sortBy', 'sortOrder']);
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value !== 'string') badRequest(`${key} must be a single string`);
    }
    const { search = '', status = 'active', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    if (!Object.hasOwn(statusConditions, status)) badRequest('status must be one of: all, active, archived, in_stock, low_stock, out_of_stock');
    if (!Object.hasOwn(sortColumns, sortBy)) badRequest('sortBy must be one of: name, price, stock_quantity, created_at');
    if (!['asc', 'desc'].includes(sortOrder)) badRequest('sortOrder must be asc or desc');
    const values = [req.user.id];
    const conditions = ['user_id = $1'];
    if (statusConditions[status]) conditions.push(statusConditions[status]);
    if (search.trim()) {
      // Treat SQL wildcard characters as literal search text.
      values.push(`%${search.trim().replace(/[\\%_]/g, '\\$&')}%`);
      conditions.push(`(name ILIKE $${values.length} OR sku ILIKE $${values.length})`);
    }
    // Both SQL fragments come exclusively from fixed allowlists, never request text.
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
    const result = await pool.query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE ${conditions.join(' AND ')} ORDER BY ${sortColumns[sortBy]} ${direction}, id ${direction}`, values);
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) { next(error); }
}

async function getProduct(req, res, next) {
  try {
    validateUuid(req.params.id);
    const result = await pool.query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!result.rowCount) return missing(res);
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
}

async function createProduct(req, res, next) {
  let client;
  let transactionStarted = false;
  let discardClient = false;
  try {
    jsonBody(req.body);
    rejectUnsupportedFields(req.body, ['name', 'sku', 'price', 'stock_quantity', 'low_stock_threshold']);
    const name = validateText(req.body.name, 'name', 150);
    const sku = validateText(req.body.sku, 'sku', 50);
    const price = validatePrice(req.body.price);
    const stock = validateInteger(req.body.stock_quantity, 'stock_quantity', 0);
    const threshold = validateInteger(req.body.low_stock_threshold, 'low_stock_threshold', 5);
    // Validate before borrowing a connection; acquisition failures also reach next().
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    const result = await client.query(`INSERT INTO products (user_id, name, sku, price, stock_quantity, low_stock_threshold)
      VALUES ($1, $2, $3, $4::numeric, $5, $6) RETURNING ${PRODUCT_COLUMNS}`, [req.user.id, name, sku, price, stock, threshold]);
    const product = result.rows[0];
    if (stock > 0) {
      await client.query(`INSERT INTO stock_movements (user_id, product_id, order_id, type, quantity_change, previous_stock, new_stock, reason)
        VALUES ($1, $2, NULL, 'INITIAL_STOCK', $3, 0, $3, $4)`, [req.user.id, product.id, stock, 'Opening stock']);
    }
    await client.query('COMMIT');
    transactionStarted = false;
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    if (client && transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { discardClient = true; console.error('Product rollback failed:', rollbackError.code || rollbackError.name); }
    }
    next(error);
  } finally {
    if (client) client.release(discardClient);
  }
}

async function updateProduct(req, res, next) {
  try {
    validateUuid(req.params.id);
    jsonBody(req.body);
    rejectUnsupportedFields(req.body, ['name', 'sku', 'price', 'low_stock_threshold']);
    if (!Object.keys(req.body).length) badRequest('Request body must contain at least one field');
    const values = [];
    const assignments = [];
    for (const key of ['name', 'sku', 'price', 'low_stock_threshold']) {
      if (!Object.hasOwn(req.body, key)) continue;
      const value = key === 'name' ? validateText(req.body[key], key, 150)
        : key === 'sku' ? validateText(req.body[key], key, 50)
          : key === 'price' ? validatePrice(req.body[key]) : validateInteger(req.body[key], key);
      values.push(value);
      assignments.push(`${key} = $${values.length}${key === 'price' ? '::numeric' : ''}`);
    }
    values.push(req.params.id, req.user.id);
    // The active predicate prevents editing a product archived by a concurrent request.
    const result = await pool.query(`UPDATE products SET ${assignments.join(', ')}
      WHERE id = $${values.length - 1} AND user_id = $${values.length} AND is_active = true RETURNING ${PRODUCT_COLUMNS}`, values);
    if (!result.rowCount) {
      const existing = await pool.query('SELECT id FROM products WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
      if (!existing.rowCount) return missing(res);
      return res.status(409).json({ success: false, message: 'Archived products cannot be edited' });
    }
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
}

async function setActiveState(req, res, next, active) {
  try {
    validateUuid(req.params.id);
    // A state-conditional update makes repeated archive/restore operations conflicts.
    const result = await pool.query(`UPDATE products SET is_active = $1 WHERE id = $2 AND user_id = $3 AND is_active = $4 RETURNING ${PRODUCT_COLUMNS}`, [active, req.params.id, req.user.id, !active]);
    if (result.rowCount) return res.status(200).json({ success: true, data: result.rows[0] });
    const existing = await pool.query('SELECT id FROM products WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!existing.rowCount) return missing(res);
    res.status(409).json({ success: false, message: `Product is already ${active ? 'active' : 'archived'}` });
  } catch (error) { next(error); }
}
const archiveProduct = (req, res, next) => setActiveState(req, res, next, false);
const restoreProduct = (req, res, next) => setActiveState(req, res, next, true);

module.exports = { getProducts, getProduct, createProduct, updateProduct, archiveProduct, restoreProduct };
