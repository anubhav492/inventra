const ORDER_COLUMNS = 'id, status, total_amount, created_at, completed_at, cancelled_at';
const ITEM_COLUMNS = 'id, product_id, product_name, sku, quantity, unit_price, (unit_price * quantity) AS line_total';

async function lockPlacedOrder(client, id, userId) {
  const result = await client.query(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, userId]);
  if (!result.rowCount) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (result.rows[0].status !== 'placed') throw Object.assign(new Error('Only placed orders can be completed or cancelled'), { status: 409 });
  return result.rows[0];
}
async function orderItems(client, id, userId) {
  return (await client.query(`SELECT ${ITEM_COLUMNS} FROM order_items WHERE order_id = $1 AND user_id = $2 ORDER BY product_id`, [id, userId])).rows;
}
module.exports = { ORDER_COLUMNS, ITEM_COLUMNS, lockPlacedOrder, orderItems };
