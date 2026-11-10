import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialInventory, loadInventory, saveInventory, INVENTORY_STORAGE_KEY } from '../services/inventoryStorage.js'
import { completeOrder, cancelOrder, placeOrder, getOrderSummary, getRevenueSeries, lineTotal, orderTotal, selectOrders, validateOrderItems } from './orders.js'
import { restockProduct, adjustStock, getInventorySummary, getLowStockAlerts } from './inventory.js'
import { updateProduct, setProductActive } from './products.js'

const items = [{ product_id: 1, quantity: '3' }, { product_id: 2, quantity: '2' }]
const memoryStorage = () => {
  const map = new Map()
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }
}

test('multi-product placement commits an order, all stock deductions and linked movements', () => {
  const state = createInitialInventory()
  const snapshot = structuredClone(state)
  const next = placeOrder(state, items)
  const order = next.orders[0]
  assert.equal(order.order_number, 'INV-0001')
  assert.equal(order.status, 'placed')
  assert.equal(order.total_amount, 799 * 3 + 2499 * 2)
  assert.equal(order.completed_at, null)
  assert.equal(order.cancelled_at, null)
  assert.ok(Number.isFinite(Date.parse(order.created_at)))
  assert.equal(next.products[0].stock_quantity, 22)
  assert.equal(next.products[1].stock_quantity, 2)
  assert.equal(next.movements.length, state.movements.length + 2)
  assert.deepEqual(next.movements.slice(0, 2).map(movement => [movement.product_id, movement.order_id, movement.type, movement.previous_stock, movement.new_stock, movement.quantity_change]), [
    [1, order.id, 'ORDER_PLACED', 25, 22, -3], [2, order.id, 'ORDER_PLACED', 4, 2, -2],
  ])
  assert.deepEqual(state, snapshot)
  assert.equal(order.items[0].product_name, 'Wireless Mouse')
  assert.equal(order.items[0].unit_price, 799)
})

test('invalid or insufficient items reject the entire operation without any partial deduction', () => {
  const state = createInitialInventory()
  for (const quantity of ['', ' ', '0', '-1', '1.5', 'NaN', 'Infinity', 'abc', '26']) {
    const snapshot = structuredClone(state)
    assert.throws(() => placeOrder(state, [{ product_id: 2, quantity: 1 }, { product_id: 1, quantity }]))
    assert.deepEqual(state, snapshot)
  }
  for (const selection of [[], null, [null], [{ product_id: 'missing', quantity: 1 }], [{ product_id: 3, quantity: 1 }], [{ product_id: 12, quantity: 1 }], [{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 1 }]]) {
    assert.throws(() => placeOrder(state, selection))
  }
  assert.equal(state.orders.length, 0)
  assert.deepEqual(validateOrderItems(state.products, [{ product_id: 2, quantity: 4 }]), {})
})

test('placement rechecks latest stock and prices rather than trusting a draft', () => {
  const state = createInitialInventory()
  const changed = adjustStock(state, 1, { quantity: 1, reason: 'Stock Count Correction' })
  assert.throws(() => placeOrder(changed, items), error => Boolean(error.fields['1']))
  const repriced = { ...state, products: updateProduct(state.products, 1, { ...state.products[0], price: 99 }) }
  const next = placeOrder(repriced, [{ product_id: 1, quantity: 2, unit_price: 1, product_name: 'Untrusted draft' }])
  assert.equal(next.orders[0].total_amount, 198)
  assert.equal(next.orders[0].items[0].unit_price, 99)
  assert.equal(next.orders[0].items[0].product_name, 'Wireless Mouse')
})

test('historical names, SKUs, prices and totals survive product edits and archiving', () => {
  let state = placeOrder(createInitialInventory(), items)
  const order = structuredClone(state.orders[0])
  state = { ...state, products: updateProduct(state.products, 1, { ...state.products[0], name: 'Renamed', sku: 'NEW-SKU', price: 9999 }) }
  state = { ...state, products: setProductActive(state.products, 1, false) }
  assert.deepEqual(state.orders[0], order)
  const cancelled = cancelOrder(state, order.id)
  assert.equal(cancelled.products[0].stock_quantity, 25)
  assert.equal(cancelled.products[0].is_active, false)
  assert.equal(cancelled.orders[0].items[0].sku, 'WM-001')
})

test('completion changes status and timestamp but never stock or movement history', () => {
  const state = placeOrder(createInitialInventory(), items)
  const next = completeOrder(state, state.orders[0].id)
  assert.equal(next.orders[0].status, 'completed')
  assert.ok(Number.isFinite(Date.parse(next.orders[0].completed_at)))
  assert.equal(next.products, state.products)
  assert.equal(next.movements, state.movements)
  assert.throws(() => completeOrder(next, next.orders[0].id))
  assert.throws(() => cancelOrder(next, next.orders[0].id))
  assert.throws(() => completeOrder(state, 'missing'))
})

test('cancellation restores every item exactly once and rejects invalid transitions', () => {
  const original = createInitialInventory()
  const placed = placeOrder(original, items)
  const next = cancelOrder(placed, placed.orders[0].id)
  assert.equal(next.orders[0].status, 'cancelled')
  assert.ok(Number.isFinite(Date.parse(next.orders[0].cancelled_at)))
  assert.deepEqual(next.products, original.products)
  assert.deepEqual(next.movements.slice(0, 2).map(movement => [movement.type, movement.previous_stock, movement.new_stock, movement.quantity_change]), [
    ['ORDER_CANCELLED', 22, 25, 3], ['ORDER_CANCELLED', 2, 4, 2],
  ])
  assert.throws(() => cancelOrder(next, next.orders[0].id))
  assert.throws(() => completeOrder(next, next.orders[0].id))
  assert.throws(() => cancelOrder(next, 'missing'))
  assert.deepEqual(next.products, original.products)
})

test('cancellation adds to current stock and remains atomic when restoration is impossible', () => {
  let state = placeOrder(createInitialInventory(), items)
  state = restockProduct(state, 1, { quantity: 10 })
  const cancelled = cancelOrder(state, state.orders[0].id)
  assert.equal(cancelled.products[0].stock_quantity, 35)
  const impossible = { ...state, products: state.products.map(product => product.id === 2 ? { ...product, stock_quantity: Number.MAX_SAFE_INTEGER } : product) }
  const snapshot = structuredClone(impossible)
  assert.throws(() => cancelOrder(impossible, impossible.orders[0].id))
  assert.deepEqual(impossible, snapshot)
})

test('inventory operations and product additions can preserve orders in the shared snapshot', () => {
  const state = placeOrder(createInitialInventory(), items)
  const next = restockProduct(state, 1, { quantity: 1 })
  assert.equal(next.orders, state.orders)
  const adjusted = adjustStock(next, 1, { quantity: 5, reason: 'Stock Count Correction' })
  assert.equal(adjusted.orders, state.orders)
  assert.equal(getInventorySummary(state.products).units, 116)
  assert.ok(getLowStockAlerts(adjusted.products).some(product => product.id === 1))
})

test('order references and generated IDs are unique, including after cancellation', () => {
  let state = placeOrder(createInitialInventory(), [{ product_id: 1, quantity: 1 }])
  state = cancelOrder(state, state.orders[0].id)
  state = placeOrder(state, [{ product_id: 1, quantity: 1 }])
  assert.equal(state.orders[0].order_number, 'INV-0002')
  assert.notEqual(state.orders[0].id, state.orders[1].id)
  assert.notEqual(state.orders[0].items[0].id, state.orders[1].items[0].id)
})

test('search uses historical product names and combines all status filters and sort modes', () => {
  let state = createInitialInventory()
  state = placeOrder(state, [{ product_id: 1, quantity: 1 }])
  state = completeOrder(state, state.orders[0].id)
  state = placeOrder(state, [{ product_id: 4, quantity: 2 }])
  state = cancelOrder(state, state.orders[0].id)
  state = placeOrder(state, [{ product_id: 6, quantity: 1 }])
  const orders = state.orders.map((order, index) => ({ ...order, created_at: `2026-11-0${7 - index}T10:00:00Z` }))
  assert.equal(selectOrders(orders, ' wireless MOUSE ', 'completed', 'newest').length, 1)
  assert.equal(selectOrders(orders, 'inv-0002', 'cancelled', 'newest').length, 1)
  assert.equal(selectOrders(orders, 'inv-0002', 'placed', 'newest').length, 0)
  assert.equal(selectOrders(orders, 'nonexistent', 'all', 'newest').length, 0)
  assert.equal(selectOrders(orders, '', 'all', 'newest')[0].order_number, 'INV-0003')
  assert.equal(selectOrders(orders, '', 'all', 'oldest')[0].order_number, 'INV-0001')
  assert.equal(selectOrders(orders, '', 'all', 'amount-desc')[0].order_number, 'INV-0002')
  assert.equal(selectOrders(orders, '', 'all', 'amount-asc')[0].order_number, 'INV-0003')
  assert.deepEqual(getOrderSummary(orders), { total: 3, placed: 1, completed: 1, activeValue: 1298, revenue: 799 })
})

test('money totals round to paise, support zero prices and reject unsafe totals', () => {
  assert.equal(lineTotal(.1, 3), .3)
  assert.equal(orderTotal([{ unit_price: .1, quantity: 3 }, { unit_price: .2, quantity: 1 }]), .5)
  let state = createInitialInventory()
  state = { ...state, products: state.products.map(product => product.id === 1 ? { ...product, price: 0 } : product) }
  assert.equal(placeOrder(state, [{ product_id: 1, quantity: 1 }]).orders[0].total_amount, 0)
  state.products[0] = { ...state.products[0], price: Number.MAX_SAFE_INTEGER }
  assert.throws(() => placeOrder(state, [{ product_id: 1, quantity: 1 }]))
})

test('realized revenue groups by completion date in IST, not placement date', () => {
  const orders = [
    { status: 'completed', total_amount: 100, created_at: '2026-10-01T00:00:00Z', completed_at: '2026-11-07T20:00:00Z' },
    { status: 'completed', total_amount: 50, completed_at: '2026-11-08T01:00:00Z' },
    { status: 'completed', total_amount: 25, completed_at: '2026-11-06T10:00:00Z' },
    { status: 'completed', total_amount: 500, completed_at: '2026-10-01T10:00:00Z' },
    { status: 'placed', total_amount: 900, completed_at: null },
    { status: 'cancelled', total_amount: 800, completed_at: null },
  ]
  const series = getRevenueSeries(orders, new Date('2026-11-08T12:00:00Z'))
  assert.equal(series.length, 7)
  assert.equal(series.at(-1).date, '2026-11-08')
  assert.equal(series.at(-1).total, 150)
  assert.equal(series.find(day => day.date === '2026-11-06').total, 25)
  assert.equal(series.reduce((sum, day) => sum + day.total, 0), 175)
  assert.equal(getOrderSummary(orders).revenue, 675)
})

test('version 1 inventory migrates without losing products or movements; orders persist in version 2', () => {
  const storage = memoryStorage()
  const seed = createInitialInventory()
  const { orders: _orders, ...legacy } = restockProduct(seed, 1, { quantity: 10 })
  storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify({ version: 1, ...legacy }))
  const migrated = loadInventory(storage)
  assert.deepEqual(migrated, { ...legacy, orders: [] })
  let state = placeOrder(migrated, items)
  state = completeOrder(state, state.orders[0].id)
  state = placeOrder(state, [{ product_id: 1, quantity: 1 }])
  state = cancelOrder(state, state.orders[0].id)
  assert.equal(saveInventory(state, storage), true)
  assert.equal(JSON.parse(storage.getItem(INVENTORY_STORAGE_KEY)).version, 2)
  assert.deepEqual(loadInventory(storage), state)
})

test('corrupted order snapshots, totals or movement references fall back safely', () => {
  const storage = memoryStorage()
  const placed = placeOrder(createInitialInventory(), items)
  for (const corrupt of [
    state => { state.orders[0].total_amount = -1 },
    state => { state.orders[0].items[0].quantity = 0 },
    state => { state.orders[0].status = 'invalid' },
    state => { state.movements[0].order_id = 'missing' },
    state => { state.orders[0].completed_at = 'invalid' },
  ]) {
    const state = structuredClone(placed)
    corrupt(state)
    storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify({ ...state, version: 2 }))
    assert.deepEqual(loadInventory(storage), createInitialInventory())
  }
})
