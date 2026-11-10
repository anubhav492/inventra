import { getProductStatus, selectProducts } from './products.js'

export const adjustmentReasons = ['Damaged Goods', 'Lost Inventory', 'Stock Count Correction', 'Other']
export const movementTypes = [
  ['INITIAL_STOCK', 'Initial Stock'], ['RESTOCK', 'Restock'], ['ADJUSTMENT', 'Adjustment'],
  ['ORDER_PLACED', 'Order Placed'], ['ORDER_CANCELLED', 'Order Cancelled'],
]
export const inventoryFilters = [
  ['all', 'All Inventory'], ['in-stock', 'In Stock'], ['low-stock', 'Low Stock'], ['out-of-stock', 'Out of Stock'],
]

export function getInventorySummary(products) {
  return products.filter(product => product.is_active).reduce((totals, product) => ({
    units: totals.units + product.stock_quantity,
    value: totals.value + product.price * product.stock_quantity,
    lowStock: totals.lowStock + Number(getProductStatus(product) === 'low-stock'),
    outOfStock: totals.outOfStock + Number(product.stock_quantity === 0),
  }), { units: 0, value: 0, lowStock: 0, outOfStock: 0 })
}

export const selectInventory = (products, query, filter, sort) => selectProducts(products.filter(product => product.is_active), query, filter, sort)

export function getStockHealth(product) {
  const reference = Math.max(product.low_stock_threshold * 3, 1)
  return { reference, percentage: Math.min(100, product.stock_quantity / reference * 100) }
}

export function getLowStockAlerts(products) {
  return products.filter(product => product.is_active && getProductStatus(product) !== 'in-stock')
    .sort((a, b) => a.stock_quantity - b.stock_quantity || a.name.localeCompare(b.name))
}

export function selectMovements(movements, productId, type) {
  return movements.filter(movement => (productId === 'all' || String(movement.product_id) === productId)
    && (type === 'all' || movement.type === type))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

export const signedQuantity = quantity => quantity > 0 ? `+${quantity}` : String(quantity)

export function validateStockChange(product, mode, values) {
  const errors = {}
  if (!product?.is_active) errors.product_id = 'Select an active product. Archived products cannot be restocked or adjusted.'
  const quantity = Number(values.quantity)
  if (String(values.quantity ?? '').trim() === '' || !Number.isSafeInteger(quantity) || quantity < (mode === 'restock' ? 1 : 0)) {
    errors.quantity = mode === 'restock' ? 'Enter a whole number greater than zero.' : 'Enter a whole number of zero or more.'
  } else if (product && mode === 'restock' && !Number.isSafeInteger(product.stock_quantity + quantity)) {
    errors.quantity = 'The resulting stock is too large. Enter a smaller quantity.'
  } else if (product && mode === 'adjust' && quantity === product.stock_quantity) {
    errors.quantity = 'Enter a quantity different from the current stock.'
  }
  if (mode === 'adjust' && !adjustmentReasons.includes(values.reason)) errors.reason = 'Choose an adjustment reason.'
  if (mode === 'adjust' && values.reason === 'Other' && !values.note?.trim()) errors.note = 'Explain the reason for this adjustment.'
  if ((values.note?.trim().length ?? 0) > 200) errors.note = 'Keep the note to 200 characters or fewer.'
  return errors
}

export function initialStockMovement(product) {
  return {
    id: `initial-${product.id}`, product_id: product.id, type: 'INITIAL_STOCK',
    quantity_change: product.stock_quantity, previous_stock: 0, new_stock: product.stock_quantity,
    reason: 'Opening stock', created_at: product.created_at,
  }
}

// A stock update and its movement are returned together; callers commit one state object.
function changeStock(state, productId, mode, values) {
  const product = state.products.find(item => item.id === productId)
  const errors = validateStockChange(product, mode, values)
  if (values.expected_stock !== undefined && product?.stock_quantity !== values.expected_stock) {
    errors.quantity = 'Stock changed since this preview. Review the current quantity and try again.'
  }
  if (Object.keys(errors).length) {
    const error = new Error('Please check the highlighted fields.')
    error.fields = errors
    throw error
  }
  const newStock = mode === 'restock' ? product.stock_quantity + Number(values.quantity) : Number(values.quantity)
  const reason = mode === 'restock' ? values.note?.trim() || 'Stock replenishment'
    : values.reason === 'Other' ? `Other: ${values.note.trim()}` : values.reason
  const movement = {
    id: crypto.randomUUID(), product_id: product.id, type: mode === 'restock' ? 'RESTOCK' : 'ADJUSTMENT',
    quantity_change: newStock - product.stock_quantity, previous_stock: product.stock_quantity,
    new_stock: newStock, reason, created_at: new Date().toISOString(),
  }
  return {
    ...state,
    products: state.products.map(item => item.id === productId ? { ...item, stock_quantity: newStock } : item),
    movements: [movement, ...state.movements],
  }
}

export const restockProduct = (state, id, values) => changeStock(state, id, 'restock', values)
export const adjustStock = (state, id, values) => changeStock(state, id, 'adjust', values)
