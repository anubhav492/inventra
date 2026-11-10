import { initialProducts } from '../data/products.js'
import { initialStockMovement, movementTypes } from '../utils/inventory.js'
import { orderStatuses, orderTotal } from '../utils/orders.js'

export const INVENTORY_STORAGE_KEY = 'inventra-inventory-v1'
const isQuantity = value => Number.isSafeInteger(value) && value >= 0
const isId = value => (typeof value === 'string' && value.length > 0) || (Number.isSafeInteger(value) && value > 0)
const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))

export function createInitialInventory() {
  const products = initialProducts.map(product => ({ ...product }))
  return { products, movements: products.map(initialStockMovement).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)), orders: [] }
}

function isValidInventory(state) {
  if (!Array.isArray(state?.products) || !Array.isArray(state?.movements)) return false
  const ids = new Set()
  const skus = new Set()
  for (const product of state.products) {
    if (!product || !isId(product.id) || ids.has(String(product.id)) || typeof product.name !== 'string' || !product.name.trim()
      || typeof product.sku !== 'string' || !product.sku.trim() || skus.has(product.sku.trim().toLowerCase())
      || typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price < 0 || product.price > Number.MAX_SAFE_INTEGER
      || !isQuantity(product.stock_quantity) || !isQuantity(product.low_stock_threshold)
      || typeof product.is_active !== 'boolean' || !isDate(product.created_at)) return false
    ids.add(String(product.id))
    skus.add(product.sku.trim().toLowerCase())
  }
  const movementIds = new Set()
  return state.movements.every(movement => {
    if (!movement || !isId(movement.id) || movementIds.has(String(movement.id))
      || !state.products.some(product => product.id === movement.product_id)
      || !movementTypes.some(([type]) => type === movement.type)
      || !isQuantity(movement.previous_stock) || !isQuantity(movement.new_stock)
      || !Number.isSafeInteger(movement.quantity_change) || movement.previous_stock + movement.quantity_change !== movement.new_stock
      || typeof movement.reason !== 'string' || !isDate(movement.created_at)) return false
    movementIds.add(String(movement.id))
    return true
  })
}

export function loadInventory(storage) {
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem(INVENTORY_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      const state = { products: parsed.products, movements: parsed.movements, orders: parsed.version === 1 ? [] : parsed.orders }
      if ([1, 2].includes(parsed.version) && isValidInventory(state) && isValidOrders(state)) return state
    }
  } catch {
    // Unavailable or malformed development storage falls back to the mock dataset.
  }
  return createInitialInventory()
}

export function saveInventory(state, storage) {
  try {
    const target = storage ?? globalThis.localStorage
    if (!target) return false
    target.setItem(INVENTORY_STORAGE_KEY, JSON.stringify({ ...state, orders: state.orders ?? [], version: 2 }))
    return true
  } catch {
    return false
  }
}

function isValidOrders(state) {
  if (!Array.isArray(state.orders)) return false
  const ids = new Set(), numbers = new Set(), itemIds = new Set()
  for (const order of state.orders) {
    if (!order || typeof order.id !== 'string' || !isId(order.id) || ids.has(order.id)
      || typeof order.order_number !== 'string' || !/^INV-\d+$/.test(order.order_number) || numbers.has(order.order_number)
      || !Object.hasOwn(orderStatuses, order.status) || !isDate(order.created_at)
      || !Array.isArray(order.items) || !order.items.length) return false
    if (order.status === 'placed' && (order.completed_at !== null || order.cancelled_at !== null)) return false
    if (order.status === 'completed' && (!isDate(order.completed_at) || order.cancelled_at !== null)) return false
    if (order.status === 'cancelled' && (!isDate(order.cancelled_at) || order.completed_at !== null)) return false
    const products = new Set()
    for (const item of order.items) {
      if (!item || !isId(item.id) || itemIds.has(String(item.id)) || products.has(String(item.product_id))
        || !state.products.some(product => product.id === item.product_id)
        || typeof item.product_name !== 'string' || !item.product_name.trim() || typeof item.sku !== 'string' || !item.sku.trim()
        || !isQuantity(item.quantity) || item.quantity === 0 || typeof item.unit_price !== 'number' || !Number.isFinite(item.unit_price) || item.unit_price < 0) return false
      products.add(String(item.product_id))
      itemIds.add(String(item.id))
    }
    if (!Number.isSafeInteger(Math.round(order.total_amount * 100)) || order.total_amount < 0 || order.total_amount !== orderTotal(order.items)) return false
    ids.add(order.id)
    numbers.add(order.order_number)
  }
  return state.movements.every(movement => {
    if (!['ORDER_PLACED', 'ORDER_CANCELLED'].includes(movement.type)) return true
    const order = state.orders.find(order => order.id === movement.order_id)
    const item = order?.items.find(item => item.product_id === movement.product_id)
    return Boolean(item && movement.quantity_change === (movement.type === 'ORDER_PLACED' ? -item.quantity : item.quantity)
      && (movement.type !== 'ORDER_CANCELLED' || order.status === 'cancelled'))
  })
}
