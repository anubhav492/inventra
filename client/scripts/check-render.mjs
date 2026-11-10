import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'

// Actual UI + actual service/cache code, with fixture HTTP responses only.
// No live requests, database writes, demo-storage fallback or browser library.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  globalThis.window = { matchMedia: () => ({ matches: false }) }
  globalThis.location = { hash: '#products', search: '' }
  const storage = new Map([['inventra-inventory-v1', 'LEGACY DEMO MUST NOT LOAD']])
  const storageReads = []
  globalThis.localStorage = { getItem: key => { storageReads.push(key); return storage.get(key) ?? null }, setItem: (key, value) => storage.set(key, value) }
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { default: AuthProvider } = await server.ssrLoadModule('/src/auth/AuthProvider.tsx')
  const { createAuthStore } = await server.ssrLoadModule('/src/auth/authStore.ts')
  const { createApiClient, ApiError } = await server.ssrLoadModule('/src/services/api.ts')
  const { createBusinessStore } = await server.ssrLoadModule('/src/services/business/store.ts')
  const { formatCurrency } = await server.ssrLoadModule('/src/utils/currency.js')
  const P = '11111111-1111-4111-8111-111111111111', P2 = '33333333-3333-4333-8333-333333333333'
  const O = '22222222-2222-4222-8222-222222222222', O2 = '44444444-4444-4444-8444-444444444444'
  const date = '2026-11-08T10:00:00Z'
  let products = [{ id: P, name: 'Server Mouse', sku: 'SERVER-1', price: '12.30', stock_quantity: 5, low_stock_threshold: 6, is_active: true, created_at: date }]
  let orders = [{ id: O, status: 'placed', total_amount: '12.30', created_at: date, completed_at: null, cancelled_at: null, items: [{ id: 'item-1', product_id: P, product_name: 'Historical Mouse', sku: 'OLD-SKU', quantity: 1, unit_price: '12.30', line_total: '12.30' }] }]
  let movements = [{ id: 'movement-1', product_id: P, product_name: 'Server movement name', sku: 'SERVER-1', order_id: null, type: 'INITIAL_STOCK', quantity_change: 5, previous_stock: 0, new_stock: 5, reason: 'Opening stock', created_at: date }]
  let writeResponse, failedPath
  const requests = []
  const envelope = data => ({ success: true, data, ...(Array.isArray(data) ? { count: data.length } : {}) })
  function metrics() {
    const active = products.filter(p => p.is_active)
    return { total_active_products: active.length, total_stock_units: String(active.reduce((n, p) => n + p.stock_quantity, 0)), total_inventory_value: active.reduce((n, p) => n + Number(p.price) * p.stock_quantity, 0).toFixed(2), low_stock_count: active.filter(p => p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_threshold).length, out_of_stock_count: active.filter(p => p.stock_quantity === 0).length, total_orders: orders.length, placed_orders: orders.filter(o => o.status === 'placed').length, completed_orders: orders.filter(o => o.status === 'completed').length, cancelled_orders: orders.filter(o => o.status === 'cancelled').length, total_revenue: orders.filter(o => o.status === 'completed').reduce((n, o) => n + Number(o.total_amount), 0).toFixed(2) }
  }
  const client = createApiClient('http://localhost:5000', async (address, options) => {
    const url = new URL(address), path = url.pathname
    requests.push({ path, method: options.method })
    assert.equal(options.credentials, 'include')
    if (path === failedPath) return Response.json({ success: false, message: 'Fixture access denied' }, { status: 403 })
    if (options.method !== 'GET') {
      assert.ok(writeResponse, 'Every mutation must have an explicit server fixture')
      const reply = writeResponse; writeResponse = undefined
      return Response.json(envelope(reply(path, JSON.parse(options.body))))
    }
    if (path === '/api/products') return Response.json(envelope(products.filter(p => url.searchParams.get('status') === 'all' || (url.searchParams.get('status') === 'archived' ? !p.is_active : p.is_active))))
    if (path.startsWith('/api/products/')) return Response.json(envelope(products.find(p => p.id === path.split('/').at(-1))))
    if (path === '/api/inventory') return Response.json(envelope(products.filter(p => p.is_active)))
    if (path === '/api/inventory/alerts' || path === '/api/dashboard/low-stock') return Response.json(envelope(products.filter(p => p.is_active && p.stock_quantity <= p.low_stock_threshold)))
    if (path === '/api/inventory/movements') return Response.json({ ...envelope(movements), pagination: { page: 1, limit: 20, total: String(movements.length) } })
    if (path === '/api/orders') return Response.json({ ...envelope(orders.map(({ items, ...o }) => ({ ...o, item_count: items.length }))), pagination: { page: 1, limit: 20, total: String(orders.length) } })
    if (path.startsWith('/api/orders/')) {
      const order = orders.find(o => o.id === path.split('/').at(-1))
      return order ? Response.json(envelope(order)) : Response.json({ success: false, message: 'Order not found' }, { status: 404 })
    }
    if (path === '/api/dashboard/summary') return Response.json(envelope(metrics()))
    if (path === '/api/dashboard/recent-orders') return Response.json(envelope(orders.map(({ items, ...o }) => ({ ...o, item_count: items.length }))))
    if (path === '/api/dashboard/revenue') return Response.json(envelope(Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 2}`, revenue: i === 6 ? metrics().total_revenue : '0.00' }))))
    assert.fail('Unexpected endpoint: ' + path)
  })
  const business = createBusinessStore({ client })
  await business.start()
  await Promise.all([business.loadInventory(), business.loadAlerts(), business.loadMovements(), business.loadOrders(), business.loadDashboard()])
  const auth = createAuthStore({ get: async () => envelope({ id: 'owner', name: 'Signed-in Owner', email: 'owner@example.com' }) })
  await auth.restore()
  const render = (hash = location.hash, sessionStore = auth, dataStore = business) => {
    location.hash = hash
    return renderToString(createElement(AuthProvider, { store: sessionStore }, createElement(App, { businessStore: dataStore }))).replace(/<!--.*?-->/g, '')
  }
  let html = render('#products')
  assert.ok(html.includes('Server Mouse'))
  assert.ok(html.includes(formatCurrency('12.30')))
  assert.ok(!html.includes('Wireless Headphones'))
  for (const route of ['#dashboard', '#inventory', '#orders', '#settings']) {
    html = render(route)
    assert.ok(!html.includes('undefined'))
    assert.ok(!html.includes('NaN'))
    assert.ok(!html.includes('Local demo workspace'))
    assert.equal(html.includes('id="page-primary-action"'), route !== '#settings')
  }
  assert.ok(render('#inventory').includes('Server movement name'))
  assert.ok(render('#orders').includes(O))
  assert.ok(render('#orders').includes('Completed Revenue'))
  assert.ok(!render('#orders').includes('INV-0001'))
  assert.ok(render('#settings').includes('owner@example.com'))
  assert.ok(render('#settings').includes('Sign out'))
  assert.ok(render('#dashboard').includes('No completed-order revenue'))

  // Canonical server responses propagate through every affected view.
  writeResponse = (path, body) => { assert.equal(path, '/api/products'); assert.equal(body.price, '9.50'); const created = { ...body, id: P2, is_active: true, created_at: date }; products = [...products, created]; return created }
  await business.addProduct({ name: 'Created on server', sku: 'SERVER-2', price: '9.50', stock_quantity: '0', low_stock_threshold: '5' })
  assert.ok(render('#products').includes('Created on server'))
  writeResponse = (_path, body) => { assert.equal('stock_quantity' in body, false); products = products.map(p => p.id === P ? { ...p, ...body } : p); return products[0] }
  await business.updateProduct(P, { name: 'Renamed server product', sku: 'SERVER-1', price: '19.99', low_stock_threshold: '6' })
  assert.ok(render('#products').includes('Renamed server product'))
  writeResponse = () => { products = products.map(p => p.id === P2 ? { ...p, is_active: false } : p); return products[1] }
  await business.archiveProduct(P2)
  assert.ok(!render('#products').includes('Created on server'))
  writeResponse = () => { products = products.map(p => p.id === P2 ? { ...p, is_active: true } : p); return products[1] }
  await business.restoreProduct(P2)
  assert.ok(render('#products').includes('Created on server'))
  writeResponse = (path, body) => { assert.equal(path, `/api/inventory/${P}/restock`); assert.deepEqual(body, { quantity: 2, reason: 'Shipment' }); products[0] = { ...products[0], stock_quantity: 7 }; const movement = { ...movements[0], id: 'restock', type: 'RESTOCK', quantity_change: 2, previous_stock: 5, new_stock: 7, reason: 'Shipment' }; movements = [movement, ...movements]; return { product: products[0], movement } }
  await business.restockProduct(P, { quantity: '2', note: 'Shipment' })
  assert.equal(business.getSnapshot().catalog.data[0].stock_quantity, 7)
  assert.ok(render('#inventory').includes('Shipment'))
  writeResponse = (_path, body) => { assert.deepEqual(body, { items: [{ product_id: P, quantity: 2 }] }); products[0] = { ...products[0], stock_quantity: 5 }; const created = { ...orders[0], id: O2, total_amount: '39.98', items: [{ ...orders[0].items[0], quantity: 2, unit_price: '19.99', line_total: '39.98' }] }; orders = [created, ...orders]; return created }
  await business.placeOrder([{ product_id: P, quantity: '2' }])
  assert.equal(business.getSnapshot().inventoryList.data[0].stock_quantity, 5)
  assert.ok(render('#orders').includes(O2))
  assert.ok(render('#dashboard').includes(O2))
  writeResponse = () => { products[0] = { ...products[0], stock_quantity: 7 }; orders = orders.map(o => o.id === O2 ? { ...o, status: 'cancelled', cancelled_at: date } : o); return orders[0] }
  await business.cancelOrder(O2)
  assert.equal(business.getSnapshot().catalog.data[0].stock_quantity, 7)
  assert.ok(render('#orders').includes('Cancelled'))
  writeResponse = () => { orders = orders.map(o => o.id === O ? { ...o, status: 'completed', completed_at: date } : o); return orders.find(o => o.id === O) }
  await business.completeOrder(O)
  assert.equal(business.getSnapshot().summary.data.total_revenue, '12.30')
  assert.ok(!render('#dashboard').includes('No completed-order revenue'))

  const { default: ProductForm } = await server.ssrLoadModule('/src/components/forms/ProductForm.jsx')
  const { default: StockForm } = await server.ssrLoadModule('/src/components/forms/StockForm.jsx')
  const { default: OrderForm } = await server.ssrLoadModule('/src/components/forms/OrderForm.jsx')
  const { default: OrderDetails } = await server.ssrLoadModule('/src/components/orders/OrderDetails.jsx')
  const catalog = { ...business.getSnapshot(), ...business, products: business.getSnapshot().catalog.data }
  const fields = renderToString(createElement(ProductForm, { onSave() {}, onCancel() {}, onError() {} }))
  assert.ok(fields.includes('name="stock_quantity"'))
  assert.ok(!renderToString(createElement(ProductForm, { product: products[0] })).includes('name="stock_quantity"'))
  const stockForm = renderToString(createElement(StockForm, { catalog, mode: 'adjust', initialProductId: P }))
  assert.ok(stockForm.includes('Quantity change'))
  assert.ok(stockForm.includes('Damaged Goods'))
  assert.ok(renderToString(createElement(OrderForm, { catalog })).includes('Renamed server product'))
  const detail = renderToString(createElement(OrderDetails, { order: orders.find(o => o.id === O), catalog }))
  assert.ok(detail.includes('Historical Mouse'))
  assert.ok(detail.includes('Completed orders are read-only'))
  assert.ok(!detail.includes('Mark as Completed'))

  products = []; orders = []; movements = []
  await business.refresh()
  assert.ok(render('#products').includes('Your catalog is empty'))
  assert.ok(render('#inventory').includes('No active inventory yet'))
  assert.ok(render('#orders').includes('No orders yet'))
  assert.ok(render('#dashboard').includes('No completed-order revenue'))
  failedPath = '/api/products'
  await business.loadCatalog()
  const failed = render('#products')
  assert.ok(failed.includes('Fixture access denied'))
  assert.ok(failed.includes('Try again'))
  assert.ok(!failed.includes('Your catalog is empty'))
  assert.ok(!failed.includes('LEGACY DEMO'))

  // Loading/anonymous/error sessions never mount or request private modules.
  const checking = createAuthStore({ get: async () => { throw Error('No SSR request') } })
  assert.ok(render('#products', checking).includes('Checking your session'))
  const anonymous = createAuthStore({ get: async () => { throw new ApiError('http', 'Authentication required', 401) } })
  await anonymous.restore()
  const before = requests.length
  for (const route of ['#dashboard', '#products', '#inventory', '#orders', '#settings']) {
    const login = render(route, anonymous)
    assert.ok(login.includes('Welcome back'))
    assert.ok(login.includes('Continue with Google'))
    assert.ok(!login.includes('workspace-sidebar'))
  }
  assert.ok(render('#signup', anonymous).includes('Confirm password'))
  location.search = '?auth_error=account_conflict'
  assert.ok(render('#login', anonymous).includes('existing method'))
  location.search = ''
  assert.equal(requests.length, before)
  assert.equal(storage.get('inventra-inventory-v1'), 'LEGACY DEMO MUST NOT LOAD')
  assert.ok(!storageReads.includes('inventra-inventory-v1'))
  console.log('PASS: real service/cache workflows, all module views, canonical mutations, empty/error states, account gates and no demo fallback')
} finally { await server.close() }