import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient, ApiError } from './api.ts'
import { createProductsApi, productQuery, productPayload, validateProductInput } from './business/products.ts'
import { createBusinessStore } from './business/store.ts'
import { createInventoryApi, inventoryQuery, stockPayload } from './business/inventory.ts'
import { createOrdersApi, orderQuery, orderPayload } from './business/orders.ts'
import { createDashboardApi, revenueChart, revenueTotal } from './business/dashboard.ts'

const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Mouse', sku: 'WM-1', price: '12.30', stock_quantity: 5, low_stock_threshold: 2, is_active: true, created_at: '2026-11-08T00:00:00Z' }
const values = { name: ' Mouse ', sku: ' WM-1 ', price: '12.30', stock_quantity: '5', low_stock_threshold: '2', user_id: 'must never send' }
const response = data => ({ success: true, data, ...(Array.isArray(data) ? { count: data.length } : {}) })

test('Products: actual list/search/filter/sort contracts and mutations send only supported fields with cookies', async () => {
  const calls = []
  const client = createApiClient('http://localhost:5000', async (url, options) => {
    calls.push({ url: new URL(url), ...options })
    return Response.json(response(options.method === 'GET' && !new URL(url).pathname.endsWith(product.id) ? [product] : product))
  })
  const service = createProductsApi(client)
  assert.equal((await service.list())[0].price, '12.30')
  await service.list(productQuery('mouse', 'low-stock', 'stock-desc'))
  assert.equal(calls[1].url.searchParams.get('status'), 'low_stock')
  assert.equal(calls[1].url.searchParams.get('sortBy'), 'stock_quantity')
  assert.equal(calls[1].url.searchParams.get('search'), 'mouse')
  await service.get(product.id)
  await service.create(values)
  await service.update(product.id, values)
  await service.archive(product.id)
  await service.restore(product.id)
  assert.deepEqual(JSON.parse(calls[3].body), { name: 'Mouse', sku: 'WM-1', price: '12.30', stock_quantity: 5, low_stock_threshold: 2 })
  assert.equal('stock_quantity' in JSON.parse(calls[4].body), false)
  assert.equal(calls[5].url.pathname, `/api/products/${product.id}/archive`)
  assert.equal(calls[6].url.pathname, `/api/products/${product.id}/restore`)
  assert.ok(calls.every(call => call.credentials === 'include'))
})

test('Products: validation preserves exact decimals and matches PostgreSQL integer/money limits', () => {
  assert.equal(productPayload(values).price, '12.30')
  for (const price of ['1.234', '-1', '1e2', '10000000000.00']) assert.ok(validateProductInput({ ...values, price }).price)
  assert.ok(validateProductInput({ ...values, stock_quantity: '2147483648' }).stock_quantity)
  assert.equal('stock_quantity' in productPayload(values, true), false)
})

test('Products: authoritative refresh follows successful mutations; failed refresh does not retry or misreport the write', async () => {
  let rows = [], writes = 0, failReads = false
  const store = createBusinessStore({ client: createApiClient('http://localhost:5000', async (_url, options) => {
    if (options.method === 'POST') { writes++; rows = [product]; return Response.json(response(product)) }
    if (failReads) throw Error('offline')
    return Response.json(response(rows))
  }) })
  await store.start()
  assert.deepEqual(store.getSnapshot().catalog.data, [])
  await store.addProduct(values)
  assert.equal(store.getSnapshot().catalog.data[0].id, product.id)
  failReads = true
  await store.addProduct(values)
  assert.equal(writes, 2)
  assert.match(store.getSnapshot().warning, /was saved/)
  assert.equal(store.getSnapshot().catalog.data, null)
  assert.equal(store.getSnapshot().pending, false)
})

const order = { id: '22222222-2222-4222-8222-222222222222', status: 'placed', total_amount: '12.30', created_at: product.created_at, completed_at: null, cancelled_at: null, items: [{ id: 'item', product_id: product.id, product_name: product.name, sku: product.sku, unit_price: '12.30', line_total: '12.30', quantity: 1 }] }
const summary = { total_active_products: 1, total_stock_units: '5', total_inventory_value: '61.50', low_stock_count: 0, out_of_stock_count: 0, total_orders: 1, placed_orders: 1, completed_orders: 0, cancelled_orders: 0, total_revenue: '0.00' }
test('Orders: paginated list, UUID details, creation/completion/cancellation use actual contracts without client prices or owners', async () => {
  const calls = []
  const service = createOrdersApi(createApiClient('http://localhost:5000', async (url, options) => {
    calls.push({ url: new URL(url), ...options })
    return Response.json(new URL(url).pathname === '/api/orders' && options.method === 'GET' ? { ...response([{ ...order, item_count: 1 }]), pagination: { page: 2, limit: 20, total: '21' } } : response(order))
  }))
  await service.list(orderQuery('222', 'placed', 'amount-desc', 2))
  assert.equal(calls[0].url.searchParams.get('page'), '2')
  assert.equal(calls[0].url.searchParams.get('sortBy'), 'total_amount')
  const details = await service.get(order.id)
  assert.equal(details.items[0].line_total, '12.30')
  await service.create([{ product_id: product.id, quantity: '2', unit_price: '0.01', user_id: 'ignore' }])
  await service.complete(order.id)
  await service.cancel(order.id)
  assert.deepEqual(JSON.parse(calls[2].body), { items: [{ product_id: product.id, quantity: 2 }] })
  assert.equal(calls[3].url.pathname, `/api/orders/${order.id}/complete`)
  assert.equal(calls[4].url.pathname, `/api/orders/${order.id}/cancel`)
  assert.deepEqual(JSON.parse(calls[3].body), {})
  assert.throws(() => orderPayload([{ product_id: product.id, quantity: 0 }]))
})

test('Orders: confirmed order mutations reload inventory, movement history, lists and all-time metrics', async () => {
  const paths = []
  const store = createBusinessStore({ client: createApiClient('http://localhost:5000', async (url, options) => {
    const path = new URL(url).pathname; paths.push(path)
    if (path === '/api/dashboard/summary') return Response.json(response(summary))
    if (path === '/api/orders' && options.method === 'GET') return Response.json({ ...response([{ ...order, item_count: 1 }]), pagination: { page: 1, limit: 20, total: '1' } })
    if (path.endsWith('/movements')) return Response.json({ ...response([]), pagination: { page: 1, limit: 20, total: '0' } })
    if (path.startsWith('/api/orders')) return Response.json(response(order))
    return Response.json(response([product]))
  }) })
  await store.start()
  await Promise.all([store.loadOrders(), store.loadSummary(), store.loadInventory(), store.loadMovements(), store.loadOrder(order.id)])
  for (const action of [() => store.placeOrder([{ product_id: product.id, quantity: 1 }]), () => store.completeOrder(order.id), () => store.cancelOrder(order.id)]) {
    paths.length = 0; await action()
    for (const path of ['/api/products', '/api/inventory', '/api/inventory/movements', '/api/orders', '/api/dashboard/summary']) assert.ok(paths.includes(path))
    assert.equal(store.getSnapshot().orderDetail.data.items[0].product_name, product.name)
  }
})

test('Orders: removing the last matching row by status transition corrects an out-of-range page', async () => {
  const pages = []
  const store = createBusinessStore({ client: createApiClient('http://localhost:5000', async url => {
    const page = Number(new URL(url).searchParams.get('page')); pages.push(page)
    return Response.json({ ...response(page === 2 ? [] : [order]), pagination: { page, limit: 20, total: '1' } })
  }) })
  await store.loadOrders({ page: 2, limit: 20 })
  assert.deepEqual(pages, [2, 1])
  assert.equal(store.getSnapshot().orderList.data.pagination.page, 1)
})

test('Products: failed requests never load demo data and 401 clears the cache and requests reauthentication', async () => {
  let status = 403, expired = 0
  const store = createBusinessStore({ onUnauthorized: () => expired++, client: createApiClient('http://localhost:5000', async () => Response.json({ success: false, message: 'Denied' }, { status })) })
  await store.start()
  assert.equal(store.getSnapshot().catalog.data, null)
  assert.equal(store.getSnapshot().catalog.error, 'Denied')
  status = 401
  await store.loadCatalog()
  assert.equal(expired, 1)
  assert.equal(store.getSnapshot().catalog.data, null)
})

test('Products: API conflicts propagate without optimistic stock/catalog changes', async () => {
  const store = createBusinessStore({ client: createApiClient('http://localhost:5000', async (_url, options) => options.method === 'GET' ? Response.json(response([product])) : Response.json({ success: false, message: 'Duplicate SKU' }, { status: 409 })) })
  await store.start()
  await assert.rejects(store.addProduct(values), error => error instanceof ApiError && error.status === 409)
  assert.equal(store.getSnapshot().catalog.data.length, 1)
})

test('Inventory: stock/alerts/history use supported queries and signed changes, never absolute quantities or user IDs', async () => {
  const calls = []
  const service = createInventoryApi(createApiClient('http://localhost:5000', async (url, options) => {
    const path = new URL(url).pathname
    calls.push({ url: new URL(url), ...options })
    return Response.json(path.endsWith('/movements') ? { ...response([]), pagination: { page: 2, limit: 20, total: '21' } } : response(options.method === 'GET' ? [{ ...product, stock_status: 'low_stock' }] : { product, movement: {} }))
  }))
  assert.equal((await service.list(inventoryQuery('mouse', 'low-stock', 'stock-desc')))[0].is_active, true)
  await service.alerts()
  const history = await service.movements({ productId: product.id, type: 'ADJUSTMENT', page: 2, limit: 20 })
  assert.equal(history.pagination.total, '21')
  await service.restock(product.id, { quantity: '3', note: 'Shipment', expected_stock: 10, user_id: 'ignore' })
  await service.adjust(product.id, { quantity: '-2', reason: 'Damaged Goods' })
  assert.equal(calls[0].url.searchParams.get('sortBy'), 'stock_quantity')
  assert.equal(calls[2].url.searchParams.get('productId'), product.id)
  assert.deepEqual(JSON.parse(calls[3].body), { quantity: 3, reason: 'Shipment' })
  assert.deepEqual(JSON.parse(calls[4].body), { quantity_change: -2, reason: 'Damaged Goods' })
  assert.throws(() => stockPayload({ quantity: 0, reason: 'Damage' }, true))
})

test('Inventory: successful restock refreshes products, inventory, alerts and the selected history page', async () => {
  const paths = []
  const client = createApiClient('http://localhost:5000', async (url, options) => {
    const path = new URL(url).pathname; paths.push(path)
    if (path.endsWith('/movements')) return Response.json({ ...response([]), pagination: { page: 1, limit: 20, total: '0' } })
    return Response.json(response(options.method === 'GET' ? [product] : { product, movement: {} }))
  })
  const store = createBusinessStore({ client })
  await store.start()
  await Promise.all([store.loadInventory(), store.loadAlerts(), store.loadMovements()])
  paths.length = 0
  await store.restockProduct(product.id, { quantity: '1' })
  for (const path of ['/api/products', '/api/inventory', '/api/inventory/alerts', '/api/inventory/movements']) assert.ok(paths.includes(path))
  assert.equal(store.getSnapshot().pending, false)
})

test('Dashboard: all four endpoints supply actual metrics and IST chart rows, including exact decimal totals', async () => {
  const calls = []
  const days = [{ date: '2026-11-07', revenue: '0.10' }, { date: '2026-11-08', revenue: '0.20' }]
  const service = createDashboardApi(createApiClient('http://localhost:5000', async url => {
    const request = new URL(url); calls.push(request)
    return Response.json(response(request.pathname.endsWith('/summary') ? summary : request.pathname.endsWith('/revenue') ? days : []))
  }))
  assert.deepEqual(await service.summary(), summary)
  assert.deepEqual(await service.recent(), [])
  assert.deepEqual(await service.lowStock(), [])
  const rows = await service.revenue()
  assert.equal(calls[3].searchParams.get('period'), '7d')
  assert.equal(revenueTotal(rows), '0.30')
  assert.equal(revenueChart(rows)[1].label, 'Sun')
  assert.deepEqual(rows, days)
})

test('Dashboard: order/stock mutations invalidate loaded metric, recent-order, low-stock and revenue resources', async () => {
  const calls = []
  const store = createBusinessStore({ client: createApiClient('http://localhost:5000', async (url, options) => {
    const path = new URL(url).pathname; calls.push(path)
    return Response.json(response(options.method !== 'GET' ? order : path.endsWith('/summary') ? summary : path.includes('/dashboard/') ? [] : [product]))
  }) })
  await store.start(); await store.loadDashboard(); calls.length = 0
  await store.placeOrder([{ product_id: product.id, quantity: 1 }])
  for (const endpoint of ['summary', 'recent-orders', 'low-stock', 'revenue']) assert.ok(calls.includes(`/api/dashboard/${endpoint}`))
  assert.equal(store.getSnapshot().revenue.error, null)
})

test('Synchronization: stale filter responses and disposed account caches never overwrite newer data', async () => {
  let resolveOld
  const old = new Promise(resolve => { resolveOld = resolve })
  const store = createBusinessStore({ client: createApiClient('http://localhost:5000', async url => {
    if (new URL(url).searchParams.get('search') === 'old') return old
    return Response.json(response([]))
  }) })
  const pending = store.loadProducts(productQuery('old'))
  await store.loadProducts(productQuery('new'))
  resolveOld(Response.json(response([product])))
  await pending
  assert.deepEqual(store.getSnapshot().productList.data, [])
  store.dispose()
  assert.equal(store.getSnapshot().catalog.data, null)
  assert.equal(store.getSnapshot().productList.data, null)
})

test('Synchronization: simultaneous writes are blocked without automatically retrying a mutation', async () => {
  let complete, writes = 0
  const pending = new Promise(resolve => { complete = resolve })
  const store = createBusinessStore({ client: createApiClient('http://localhost:5000', async (_url, options) => {
    if (options.method !== 'GET') { writes++; return pending }
    return Response.json(response([product]))
  }) })
  const first = store.addProduct(values)
  await assert.rejects(store.addProduct(values), /in progress/)
  complete(Response.json(response(product))); await first
  assert.equal(writes, 1)
})
