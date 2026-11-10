const pool = require('../config/db');
const transaction = require('../utils/transaction');
const v = require('../utils/apiValidation');
const { MAX_ORDER_CENTS, toCents, fromCents } = require('../utils/money');
const { ORDER_COLUMNS, ITEM_COLUMNS, lockPlacedOrder, orderItems } = require('../utils/orderSql');
const { insertMovement } = require('../utils/inventorySql');

async function getOrders(req, res, next) {
  try {
    v.queryFields(req.query, ['status', 'search', 'startDate', 'endDate', 'page', 'limit', 'sortBy', 'sortOrder']);
    const { status = 'all', search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    v.choice(status, ['all', 'placed', 'completed', 'cancelled'], 'status');
    v.choice(sortBy, ['created_at', 'total_amount'], 'sortBy');
    v.choice(sortOrder, ['asc', 'desc'], 'sortOrder');
    const paging = v.pagination(req.query), values = [req.user.id], conditions = ['o.user_id = $1'];
    if (status !== 'all') { values.push(status); conditions.push(`o.status = $${values.length}`); }
    if (search.trim()) { values.push(v.searchPattern(search)); conditions.push(`o.id::text ILIKE $${values.length}`); }
    v.dates(conditions, values, req.query, 'o.created_at');
    const where = conditions.join(' AND ');
    const column = { created_at: 'o.created_at', total_amount: 'o.total_amount' }[sortBy];
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
    const [count, result] = await Promise.all([
      pool.query(`SELECT COUNT(*)::text AS total FROM orders o WHERE ${where}`, values),
      pool.query(`SELECT o.id, o.status, o.total_amount, o.created_at, o.completed_at, o.cancelled_at,
        (SELECT COUNT(*)::integer FROM order_items i WHERE i.order_id = o.id AND i.user_id = o.user_id) AS item_count
        FROM orders o WHERE ${where} ORDER BY ${column} ${direction}, o.id ${direction}
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, paging.limit, paging.offset]),
    ]);
    res.json({ success: true, count: result.rows.length, pagination: { page: paging.page, limit: paging.limit, total: count.rows[0].total }, data: result.rows });
  } catch (error) { next(error); }
}

async function getOrder(req, res, next) {
  try {
    const id = v.uuid(req.params.id, 'Order ID');
    v.queryFields(req.query, []);
    // One statement gives a coherent order/items snapshot; prices stay decimal strings inside JSON.
    const result = await pool.query(`SELECT o.id, o.status, o.total_amount, o.created_at, o.completed_at, o.cancelled_at,
      COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'product_id', i.product_id, 'product_name', i.product_name,
        'sku', i.sku, 'quantity', i.quantity, 'unit_price', i.unit_price::text, 'line_total', (i.unit_price * i.quantity)::text)
        ORDER BY i.product_id) FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb) AS items
      FROM orders o LEFT JOIN order_items i ON i.order_id = o.id AND i.user_id = o.user_id
      WHERE o.id = $1 AND o.user_id = $2 GROUP BY o.id`, [id, req.user.id]);
    if (!result.rowCount) throw v.httpError(404, 'Order not found');
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
}

function validateItems(body) {
  v.bodyFields(body, ['items']);
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) throw v.httpError(400, 'items must contain between 1 and 100 products');
  const seen = new Set();
  const items = body.items.map(item => {
    v.bodyFields(item, ['product_id', 'quantity']);
    const id = v.uuid(item.product_id, 'product_id');
    if (seen.has(id)) throw v.httpError(400, 'Duplicate product IDs are not allowed');
    seen.add(id);
    return { product_id: id, quantity: v.positiveInteger(item.quantity, 'quantity') };
  });
  return items.sort((a, b) => a.product_id.localeCompare(b.product_id));
}

async function createOrder(req, res, next) {
  try {
    v.queryFields(req.query, []);
    const items = validateItems(req.body);
    const data = await transaction(async client => {
      const locked = await client.query(`SELECT id, name, sku, price, stock_quantity, is_active FROM products
        WHERE user_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [req.user.id, items.map(item => item.product_id)]);
      const products = new Map(locked.rows.map(product => [product.id, product]));
      let cents = 0n;
      for (const item of items) {
        const product = products.get(item.product_id);
        if (!product) throw v.httpError(404, 'One or more products were not found');
        if (!product.is_active) throw v.httpError(409, 'Archived products cannot be ordered');
        if (product.stock_quantity < item.quantity) throw v.httpError(409, 'Insufficient stock for one or more products');
        cents += toCents(product.price) * BigInt(item.quantity);
      }
      if (cents > MAX_ORDER_CENTS) throw v.httpError(409, 'Order total exceeds the supported NUMERIC(12,2) range');
      const created = await client.query(`INSERT INTO orders (user_id, status, total_amount)
        VALUES ($1, 'placed', $2::numeric) RETURNING ${ORDER_COLUMNS}`, [req.user.id, fromCents(cents)]);
      const order = created.rows[0], snapshots = [];
      for (const item of items) {
        const product = products.get(item.product_id), newStock = product.stock_quantity - item.quantity;
        const savedItem = await client.query(`INSERT INTO order_items (order_id, user_id, product_id, product_name, sku, quantity, unit_price)
          VALUES ($1, $2, $3, $4, $5, $6, $7::numeric) RETURNING ${ITEM_COLUMNS}`,
        [order.id, req.user.id, product.id, product.name, product.sku, item.quantity, product.price]);
        snapshots.push(savedItem.rows[0]);
        const updated = await client.query('UPDATE products SET stock_quantity = $1 WHERE id = $2 AND user_id = $3', [newStock, product.id, req.user.id]);
        if (updated.rowCount !== 1) throw v.httpError(409, 'Stock could not be updated');
        await insertMovement(client, { userId: req.user.id, productId: product.id, orderId: order.id, type: 'ORDER_PLACED', previous: product.stock_quantity, next: newStock, reason: 'Order placed' });
      }
      return { ...order, items: snapshots };
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

async function completeOrder(req, res, next) {
  try {
    const id = v.uuid(req.params.id, 'Order ID');
    v.queryFields(req.query, []);
    v.emptyBody(req);
    const data = await transaction(async client => {
      await lockPlacedOrder(client, id, req.user.id);
      const result = await client.query(`UPDATE orders SET status = 'completed', completed_at = NOW()
        WHERE id = $1 AND user_id = $2 RETURNING ${ORDER_COLUMNS}`, [id, req.user.id]);
      if (result.rowCount !== 1) throw v.httpError(409, 'Order could not be completed');
      return { ...result.rows[0], items: await orderItems(client, id, req.user.id) };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

async function cancelOrder(req, res, next) {
  try {
    const id = v.uuid(req.params.id, 'Order ID');
    v.queryFields(req.query, []);
    v.emptyBody(req);
    const data = await transaction(async client => {
      // Serialize cancellation/completion on the order before touching product rows.
      await lockPlacedOrder(client, id, req.user.id);
      const items = await orderItems(client, id, req.user.id);
      if (!items.length) throw v.httpError(409, 'Order has no items to restore');
      const locked = await client.query(`SELECT id, stock_quantity FROM products
        WHERE user_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [req.user.id, items.map(item => item.product_id)]);
      const products = new Map(locked.rows.map(product => [product.id, product]));
      // Precheck every restoration before performing any updates; archived rows are included.
      for (const item of items) {
        const product = products.get(item.product_id);
        if (!product) throw v.httpError(409, 'An order product could not be restored');
        v.checkedStock(product.stock_quantity + item.quantity);
      }
      for (const item of items) {
        const product = products.get(item.product_id), newStock = product.stock_quantity + item.quantity;
        const restored = await client.query('UPDATE products SET stock_quantity = $1 WHERE id = $2 AND user_id = $3', [newStock, product.id, req.user.id]);
        if (restored.rowCount !== 1) throw v.httpError(409, 'Stock could not be restored');
        await insertMovement(client, { userId: req.user.id, productId: product.id, orderId: id, type: 'ORDER_CANCELLED', previous: product.stock_quantity, next: newStock, reason: 'Order cancelled' });
      }
      const updated = await client.query(`UPDATE orders SET status = 'cancelled', cancelled_at = NOW()
        WHERE id = $1 AND user_id = $2 RETURNING ${ORDER_COLUMNS}`, [id, req.user.id]);
      if (updated.rowCount !== 1) throw v.httpError(409, 'Order could not be cancelled');
      return { ...updated.rows[0], items };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

module.exports = { getOrders, getOrder, createOrder, completeOrder, cancelOrder, validateItems };
