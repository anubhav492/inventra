const pool = require('../config/db');
const v = require('../utils/apiValidation');
const { INVENTORY_COLUMNS, STOCK_STATUS } = require('../utils/inventorySql');

async function getSummary(req, res, next) {
  try {
    v.queryFields(req.query, []);
    // Aggregate each table once, independently, so product/order joins cannot multiply totals.
    const result = await pool.query(`WITH inventory AS (
      SELECT COUNT(*)::integer AS total_active_products, COALESCE(SUM(stock_quantity), 0) AS total_stock_units,
        COALESCE(SUM(price * stock_quantity), 0.00) AS total_inventory_value,
        COUNT(*) FILTER (WHERE stock_quantity > 0 AND stock_quantity <= low_stock_threshold)::integer AS low_stock_count,
        COUNT(*) FILTER (WHERE stock_quantity = 0)::integer AS out_of_stock_count
      FROM products WHERE user_id = $1 AND is_active = true
    ), sales AS (
      SELECT COUNT(*)::integer AS total_orders,
        COUNT(*) FILTER (WHERE status = 'placed')::integer AS placed_orders,
        COUNT(*) FILTER (WHERE status = 'completed')::integer AS completed_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled')::integer AS cancelled_orders,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'completed'), 0.00) AS total_revenue
      FROM orders WHERE user_id = $1
    ) SELECT * FROM inventory CROSS JOIN sales`, [req.user.id]);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
}

async function getRecentOrders(req, res, next) {
  try {
    v.queryFields(req.query, ['limit']);
    const limit = v.pageInteger(req.query.limit, 5, 10, 'limit');
    if (limit < 5) throw v.httpError(400, 'limit must be between 5 and 10');
    const result = await pool.query(`SELECT o.id, o.status, o.total_amount, o.created_at,
      (SELECT COUNT(*)::integer FROM order_items i WHERE i.order_id = o.id AND i.user_id = o.user_id) AS item_count
      FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC, o.id DESC LIMIT $2`, [req.user.id, limit]);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) { next(error); }
}

async function getLowStock(req, res, next) {
  try {
    v.queryFields(req.query, ['limit']);
    const limit = v.pageInteger(req.query.limit, 5, 10, 'limit');
    const result = await pool.query(`SELECT ${INVENTORY_COLUMNS}, ${STOCK_STATUS} FROM products p
      WHERE p.user_id = $1 AND p.is_active = true AND p.stock_quantity <= p.low_stock_threshold
      ORDER BY p.stock_quantity ASC, p.name ASC, p.id ASC LIMIT $2`, [req.user.id, limit]);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) { next(error); }
}

async function getRevenue(req, res, next) {
  try {
    v.queryFields(req.query, ['period']);
    const period = v.choice(req.query.period ?? '30d', ['7d', '30d', '90d'], 'period');
    const days = { '7d': 7, '30d': 30, '90d': 90 }[period];
    const result = await pool.query(`WITH bounds AS (
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AS today
    ), days AS (
      SELECT generate_series(today - ($2::integer - 1), today, INTERVAL '1 day')::date AS date FROM bounds
    ), totals AS (
      SELECT (completed_at AT TIME ZONE 'Asia/Kolkata')::date AS date, SUM(total_amount) AS revenue
      FROM orders, bounds WHERE user_id = $1 AND status = 'completed'
        AND completed_at >= ((today - ($2::integer - 1))::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND completed_at < ((today + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
      GROUP BY (completed_at AT TIME ZONE 'Asia/Kolkata')::date
    ) SELECT to_char(d.date, 'YYYY-MM-DD') AS date, COALESCE(t.revenue, 0.00) AS revenue
      FROM days d LEFT JOIN totals t ON t.date = d.date ORDER BY d.date`, [req.user.id, days]);
    res.json({ success: true, period, timezone: 'Asia/Kolkata', data: result.rows });
  } catch (error) { next(error); }
}
module.exports = { getSummary, getRecentOrders, getLowStock, getRevenue };
