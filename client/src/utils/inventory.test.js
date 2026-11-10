import test from 'node:test'
import assert from 'node:assert/strict'
import { createProduct, updateProduct, setProductActive, getProductStatus } from './products.js'
import { adjustStock, restockProduct, getInventorySummary, getLowStockAlerts, getStockHealth, selectInventory, selectMovements, validateStockChange, initialStockMovement, signedQuantity } from './inventory.js'
import { createInitialInventory, loadInventory, saveInventory, INVENTORY_STORAGE_KEY } from '../services/inventoryStorage.js'

const values = { name: 'Travel Charger', sku: 'TC-100', price: '999', stock_quantity: '10', low_stock_threshold: '5' }
const memoryStorage = () => {
  const map = new Map()
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }
}

test('inventory summaries and alerts use only active shared products', () => {
  const state = createInitialInventory()
  const summary = getInventorySummary(state.products)
  assert.equal(summary.units, 121)
  assert.equal(summary.lowStock, 4)
  assert.equal(summary.outOfStock, 2)
  assert.equal(summary.value, state.products.filter(product => product.is_active).reduce((sum, product) => sum + product.price * product.stock_quantity, 0))
  const alerts = getLowStockAlerts(state.products)
  assert.equal(alerts.length, 6)
  assert.ok(alerts.slice(0, 2).every(product => product.stock_quantity === 0))
  assert.ok(alerts.every(product => product.is_active && getProductStatus(product) !== 'in-stock'))
})

test('inventory search, statuses, and all sorting choices compose', () => {
  const { products } = createInitialInventory()
  assert.equal(selectInventory(products, '  MK-002 ', 'low-stock', 'stock-desc')[0].name, 'Mechanical Keyboard')
  assert.equal(selectInventory(products, 'headphones', 'out-of-stock', 'price-asc').length, 1)
  assert.equal(selectInventory(products, 'WM-001', 'low-stock', 'name-asc').length, 0)
  assert.equal(selectInventory(products, '', 'archived', 'name-asc').length, 0)
  for (const sort of ['name-asc', 'name-desc', 'price-asc', 'price-desc', 'stock-asc', 'stock-desc']) {
    const rows = selectInventory(products, '', 'all', sort)
    assert.equal(rows.length, 11)
    const [field, direction] = sort.split('-')
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i]
      const comparison = field === 'name' ? a.name.localeCompare(b.name, 'en-IN', { sensitivity: 'base' }) : field === 'price' ? a.price - b.price : a.stock_quantity - b.stock_quantity
      assert.ok(direction === 'asc' ? comparison <= 0 : comparison >= 0)
    }
  }
})

test('restock preserves product details and records exact before/after values atomically', () => {
  const state = createInitialInventory()
  const snapshot = structuredClone(state)
  const product = state.products[0]
  const next = restockProduct(state, product.id, { quantity: '15', note: '  New shipment received  ' })
  assert.deepEqual(next.products[0], { ...product, stock_quantity: 40 })
  assert.equal(next.movements.length, state.movements.length + 1)
  assert.deepEqual({ ...next.movements[0], id: 'generated', created_at: 'now' }, {
    id: 'generated', product_id: product.id, type: 'RESTOCK', quantity_change: 15,
    previous_stock: 25, new_stock: 40, reason: 'New shipment received', created_at: 'now',
  })
  assert.deepEqual(state, snapshot)
  assert.equal(getInventorySummary(next.products).units, 136)
  assert.equal(getInventorySummary(next.products).value - getInventorySummary(state.products).value, product.price * 15)
})

test('restock rejects empty, zero, decimal, negative, invalid and overflowing quantities', () => {
  const state = createInitialInventory()
  for (const quantity of ['', ' ', '0', '-1', '1.5', 'no', 'Infinity', '9007199254740991']) {
    assert.throws(() => restockProduct(state, 1, { quantity }), error => Boolean(error.fields.quantity), quantity)
  }
  const next = restockProduct(state, 3, { quantity: 1 })
  assert.equal(next.products.find(product => product.id === 3).stock_quantity, 1)
  assert.equal(next.movements[0].reason, 'Stock replenishment')
})

test('archived and missing products cannot be restocked or adjusted', () => {
  const state = createInitialInventory()
  for (const id of [12, 'missing']) {
    assert.throws(() => restockProduct(state, id, { quantity: 1 }), error => Boolean(error.fields.product_id))
    assert.throws(() => adjustStock(state, id, { quantity: 0, reason: 'Lost Inventory' }), error => Boolean(error.fields.product_id))
  }
})

test('adjustments support increases and decreases to zero and require a valid reason', () => {
  const state = createInitialInventory()
  let next = adjustStock(state, 1, { quantity: '22', reason: 'Damaged Goods' })
  assert.equal(next.products[0].stock_quantity, 22)
  assert.equal(next.movements[0].quantity_change, -3)
  assert.equal(next.movements[0].previous_stock, 25)
  assert.equal(next.movements[0].new_stock, 22)
  next = adjustStock(next, 1, { quantity: '0', reason: 'Lost Inventory' })
  assert.equal(next.movements[0].quantity_change, -22)
  assert.equal(getProductStatus(next.products[0]), 'out-of-stock')
  next = adjustStock(next, 1, { quantity: '30', reason: 'Other', note: '  Shelf count verified  ' })
  assert.equal(next.movements[0].quantity_change, 30)
  assert.equal(next.movements[0].reason, 'Other: Shelf count verified')
  for (const input of [
    { quantity: '', reason: 'Damaged Goods' }, { quantity: '-1', reason: 'Lost Inventory' },
    { quantity: '1.5', reason: 'Stock Count Correction' }, { quantity: '25', reason: 'Stock Count Correction' },
    { quantity: '22', reason: '' }, { quantity: '22', reason: 'Invalid' },
    { quantity: '22', reason: 'Other', note: ' ' },
  ]) assert.throws(() => adjustStock(state, 1, input))
  assert.ok(validateStockChange(state.products[0], 'restock', { quantity: '1', note: 'a'.repeat(201) }).note)
})

test('stale stock confirmations fail without changing state or recording a movement', () => {
  const state = createInitialInventory()
  const next = restockProduct(state, 1, { quantity: 5 })
  assert.throws(() => adjustStock(next, 1, { quantity: 22, reason: 'Damaged Goods', expected_stock: 25 }), error => Boolean(error.fields.quantity))
  assert.throws(() => restockProduct(next, 1, { quantity: 5, expected_stock: 25 }), error => Boolean(error.fields.quantity))
  assert.equal(next.products[0].stock_quantity, 30)
  assert.equal(next.movements.length, state.movements.length + 1)
})

test('stock visualization handles zero thresholds and never limits real stock', () => {
  assert.deepEqual(getStockHealth({ stock_quantity: 0, low_stock_threshold: 0 }), { reference: 1, percentage: 0 })
  assert.deepEqual(getStockHealth({ stock_quantity: 25, low_stock_threshold: 5 }), { reference: 15, percentage: 100 })
  const state = createInitialInventory()
  const next = restockProduct(state, 1, { quantity: 1000 })
  assert.equal(next.products[0].stock_quantity, 1025)
  assert.equal(getStockHealth(next.products[0]).percentage, 100)
})

test('history sorts newest first and combines product/type filters including archived products', () => {
  const state = createInitialInventory()
  const movements = [
    { id: 'old', product_id: 1, type: 'RESTOCK', created_at: '2026-11-07T10:00:00Z' },
    { id: 'new', product_id: 1, type: 'ADJUSTMENT', created_at: '2026-11-07T12:00:00Z' },
  ]
  assert.deepEqual(selectMovements(movements, 'all', 'all').map(item => item.id), ['new', 'old'])
  assert.equal(selectMovements(movements, '1', 'RESTOCK')[0].id, 'old')
  assert.equal(selectMovements(movements, '2', 'RESTOCK').length, 0)
  assert.equal(selectMovements(state.movements, '12', 'INITIAL_STOCK').length, 1)
  assert.ok(state.movements.every(movement => movement.type === 'INITIAL_STOCK'))
  assert.equal(signedQuantity(10), '+10')
  assert.equal(signedQuantity(-3), '-3')
  assert.equal(signedQuantity(0), '0')
})

test('add product, restock, edit, archive, restore and reload use one product collection', () => {
  const storage = memoryStorage()
  let state = createInitialInventory()
  const products = createProduct(state.products, values)
  const product = products.at(-1)
  state = { ...state, products, movements: [initialStockMovement(product), ...state.movements] }
  assert.equal(selectInventory(state.products, 'TC-100', 'all', 'name-asc')[0].stock_quantity, 10)
  state = restockProduct(state, product.id, { quantity: 15 })
  assert.equal(state.products.find(item => item.id === product.id).stock_quantity, 25)
  state = { ...state, products: updateProduct(state.products, product.id, { ...values, name: 'Travel Charger Pro', stock_quantity: 999 }) }
  assert.equal(state.products.at(-1).stock_quantity, 25)
  state = { ...state, products: setProductActive(state.products, product.id, false) }
  assert.equal(selectInventory(state.products, 'TC-100', 'all', 'name-asc').length, 0)
  state = { ...state, products: setProductActive(state.products, product.id, true) }
  assert.equal(saveInventory(state, storage), true)
  const reloaded = loadInventory(storage)
  assert.deepEqual(reloaded, state)
  assert.equal(reloaded.products.at(-1).stock_quantity, 25)
  assert.equal(reloaded.movements[0].type, 'RESTOCK')
  assert.equal(reloaded.movements[1].type, 'INITIAL_STOCK')
})

test('persistence preserves empty inventory and fails safely with corrupt or blocked storage', () => {
  const storage = memoryStorage()
  assert.equal(saveInventory({ products: [], movements: [] }, storage), true)
  assert.deepEqual(loadInventory(storage), { products: [], movements: [], orders: [] })
  storage.setItem(INVENTORY_STORAGE_KEY, '{invalid')
  assert.deepEqual(loadInventory(storage), createInitialInventory())
  const invalid = createInitialInventory()
  invalid.products[0].stock_quantity = -1
  storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify({ version: 1, ...invalid }))
  assert.deepEqual(loadInventory(storage), createInitialInventory())
  const blocked = { getItem() { throw Error('blocked') }, setItem() { throw Error('full') } }
  assert.deepEqual(loadInventory(blocked), createInitialInventory())
  assert.equal(saveInventory(createInitialInventory(), blocked), false)
})
