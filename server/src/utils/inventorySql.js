const PRODUCT_COLUMNS = 'id, name, sku, price, stock_quantity, low_stock_threshold, is_active, created_at';
const INVENTORY_COLUMNS = 'p.id, p.name, p.sku, p.price, p.stock_quantity, p.low_stock_threshold';
const STOCK_STATUS = "CASE WHEN p.stock_quantity = 0 THEN 'out_of_stock' WHEN p.stock_quantity <= p.low_stock_threshold THEN 'low_stock' ELSE 'in_stock' END AS stock_status";

async function insertMovement(client, { userId, productId, orderId = null, type, previous, next, reason }) {
  const result = await client.query(`INSERT INTO stock_movements
    (user_id, product_id, order_id, type, quantity_change, previous_stock, new_stock, reason)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, product_id, order_id, type, quantity_change, previous_stock, new_stock, reason, created_at`,
  [userId, productId, orderId, type, next - previous, previous, next, reason]);
  return result.rows[0];
}
module.exports = { PRODUCT_COLUMNS, INVENTORY_COLUMNS, STOCK_STATUS, insertMovement };
