const pool = require('../config/db');
const transaction = require('../utils/transaction');
const { PRODUCT_COLUMNS, INVENTORY_COLUMNS, STOCK_STATUS, insertMovement } = require('../utils/inventorySql');
const v = require('../utils/apiValidation');

async function getInventory(req, res, next) {
  try {
    v.queryFields(req.query, ['search', 'status', 'sortBy', 'sortOrder']);
    const { search = '', status = 'all', sortBy = 'name', sortOrder = 'asc' } = req.query;
    v.choice(status, ['all', 'in_stock', 'low_stock', 'out_of_stock'], 'status');
    v.choice(sortBy, ['name', 'stock_quantity', 'price'], 'sortBy');
    v.choice(sortOrder, ['asc', 'desc'], 'sortOrder');
    const columns = { name: 'p.name', stock_quantity: 'p.stock_quantity', price: 'p.price' };
    const filters = { all: '', in_stock: 'p.stock_quantity > p.low_stock_threshold', low_stock: 'p.stock_quantity > 0 AND p.stock_quantity <= p.low_stock_threshold', out_of_stock: 'p.stock_quantity = 0' };
    const values = [req.user.id], conditions = ['p.user_id = $1', 'p.is_active = true'];
    if (filters[status]) conditions.push(filters[status]);
    if (search.trim()) { values.push(v.searchPattern(search)); conditions.push(`(p.name ILIKE $${values.length} OR p.sku ILIKE $${values.length})`); }
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
    const result = await pool.query(`SELECT ${INVENTORY_COLUMNS}, ${STOCK_STATUS} FROM products p WHERE ${conditions.join(' AND ')} ORDER BY ${columns[sortBy]} ${direction}, p.id ${direction}`, values);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) { next(error); }
}

async function getAlerts(req, res, next) {
  try {
    v.queryFields(req.query, []);
    const result = await pool.query(`SELECT ${INVENTORY_COLUMNS}, ${STOCK_STATUS} FROM products p
      WHERE p.user_id = $1 AND p.is_active = true AND p.stock_quantity <= p.low_stock_threshold
      ORDER BY p.stock_quantity ASC, p.name ASC, p.id ASC`, [req.user.id]);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) { next(error); }
}

async function getMovements(req, res, next) {
  try {
    v.queryFields(req.query, ['productId', 'type', 'startDate', 'endDate', 'page', 'limit']);
    const paging = v.pagination(req.query);
    const values = [req.user.id], conditions = ['m.user_id = $1'];
    if (req.query.productId !== undefined) { values.push(v.uuid(req.query.productId, 'productId')); conditions.push(`m.product_id = $${values.length}`); }
    if (req.query.type !== undefined) { values.push(v.choice(req.query.type, v.MOVEMENT_TYPES, 'type')); conditions.push(`m.type = $${values.length}`); }
    v.dates(conditions, values, req.query, 'm.created_at');
    const where = conditions.join(' AND ');
    const [count, result] = await Promise.all([
      pool.query(`SELECT COUNT(*)::text AS total FROM stock_movements m WHERE ${where}`, values),
      pool.query(`SELECT m.id, m.product_id, p.name AS product_name, p.sku, m.order_id, m.type,
        m.quantity_change, m.previous_stock, m.new_stock, m.reason, m.created_at
        FROM stock_movements m JOIN products p ON p.id = m.product_id AND p.user_id = m.user_id
        WHERE ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, paging.limit, paging.offset]),
    ]);
    res.json({ success: true, count: result.rows.length, pagination: { page: paging.page, limit: paging.limit, total: count.rows[0].total }, data: result.rows });
  } catch (error) { next(error); }
}

async function changeStock(req, res, next, adjustment) {
  try {
    const id = v.uuid(req.params.productId, 'productId');
    v.queryFields(req.query, []);
    v.bodyFields(req.body, [adjustment ? 'quantity_change' : 'quantity', 'reason']);
    const change = adjustment ? v.signedInteger(req.body.quantity_change) : v.positiveInteger(req.body.quantity, 'quantity');
    const reason = v.reason(req.body.reason, adjustment);
    const data = await transaction(async client => {
      const locked = await client.query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, req.user.id]);
      const product = locked.rows[0];
      if (!product) throw v.httpError(404, 'Product not found');
      if (!product.is_active) throw v.httpError(409, 'Archived products cannot have their stock changed');
      const newStock = v.checkedStock(product.stock_quantity + change);
      const updated = await client.query(`UPDATE products SET stock_quantity = $1 WHERE id = $2 AND user_id = $3 RETURNING ${PRODUCT_COLUMNS}`, [newStock, id, req.user.id]);
      if (updated.rowCount !== 1) throw v.httpError(409, 'Stock could not be updated');
      const movement = await insertMovement(client, { userId: req.user.id, productId: id, type: adjustment ? 'ADJUSTMENT' : 'RESTOCK', previous: product.stock_quantity, next: newStock, reason });
      return { product: updated.rows[0], movement };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
const restock = (req, res, next) => changeStock(req, res, next, false);
const adjust = (req, res, next) => changeStock(req, res, next, true);
module.exports = { getInventory, getAlerts, getMovements, restock, adjust };
