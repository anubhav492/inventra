export const orderStatuses = {
  placed: ['Placed', 'amber'], completed: ['Completed', 'green'], cancelled: ['Cancelled', 'red'],
}
export const orderFilters = [['all', 'All Orders'], ['placed', 'Placed'], ['completed', 'Completed'], ['cancelled', 'Cancelled']]
export const orderSorts = [['newest', 'Newest First'], ['oldest', 'Oldest First'], ['amount-desc', 'Amount High–Low'], ['amount-asc', 'Amount Low–High']]

export const lineTotal = (price, quantity) => Math.round((price * quantity + Number.EPSILON) * 100) / 100
export const orderTotal = items => items.reduce((cents, item) => cents + Math.round(lineTotal(item.unit_price, item.quantity) * 100), 0) / 100
export const orderUnits = order => order.items.reduce((sum, item) => sum + item.quantity, 0)

export function getOrderSummary(orders) {
  return {
    total: orders.length,
    placed: orders.filter(order => order.status === 'placed').length,
    completed: orders.filter(order => order.status === 'completed').length,
    activeValue: Math.round(orders.filter(order => order.status !== 'cancelled').reduce((sum, order) => sum + Math.round(order.total_amount * 100), 0)) / 100,
    revenue: Math.round(orders.filter(order => order.status === 'completed').reduce((sum, order) => sum + Math.round(order.total_amount * 100), 0)) / 100,
  }
}

export function selectOrders(orders, query, status, sort) {
  const search = query.trim().toLowerCase()
  return orders.filter(order => (status === 'all' || order.status === status) && (
    order.order_number.toLowerCase().includes(search) || order.id.toLowerCase().includes(search)
    || order.items.some(item => item.product_name.toLowerCase().includes(search))
  )).sort((a, b) => {
    if (sort === 'amount-asc') return a.total_amount - b.total_amount || Date.parse(b.created_at) - Date.parse(a.created_at)
    if (sort === 'amount-desc') return b.total_amount - a.total_amount || Date.parse(b.created_at) - Date.parse(a.created_at)
    const dateDifference = Date.parse(b.created_at) - Date.parse(a.created_at)
    return sort === 'oldest' ? -dateDifference : dateDifference
  })
}

export function validateOrderItems(products, items) {
  const errors = {}
  if (!Array.isArray(items) || !items.length) return { form: 'Select at least one product to place an order.' }
  const seen = new Set()
  for (const item of items) {
    if (!item || item.product_id == null) { errors.form = 'Select valid products for this order.'; continue }
    const product = products.find(product => product.id === item.product_id)
    const key = String(item.product_id)
    if (seen.has(key)) { errors.form = 'Each product can appear only once in an order.'; continue }
    seen.add(key)
    if (!product?.is_active || product.stock_quantity === 0) {
      errors[key] = 'This product is unavailable. Remove it from the order.'
    } else if (String(item.quantity ?? '').trim() === '' || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
      errors[key] = 'Enter a whole quantity greater than zero.'
    } else if (Number(item.quantity) > product.stock_quantity) {
      errors[key] = `Only ${product.stock_quantity} units are available.`
    } else if (!Number.isSafeInteger(Math.round(lineTotal(product.price, Number(item.quantity)) * 100))) {
      errors[key] = 'The line total is too large. Reduce the quantity.'
    }
  }
  if (!Object.keys(errors).length) {
    const total = items.reduce((sum, item) => sum + Math.round(lineTotal(products.find(product => product.id === item.product_id).price, Number(item.quantity)) * 100), 0)
    if (!Number.isSafeInteger(total)) errors.form = 'This order total is too large.'
  }
  return errors
}

function fail(message, fields) {
  const error = new Error(message)
  if (fields) error.fields = fields
  throw error
}

export function placeOrder(state, requestedItems) {
  const errors = validateOrderItems(state.products, requestedItems)
  if (Object.keys(errors).length) fail('Please check the order items.', errors)
  const timestamp = new Date().toISOString()
  const id = crypto.randomUUID()
  const previousNumber = state.orders.reduce((max, order) => Math.max(max, Number(order.order_number.match(/^INV-(\d+)$/)?.[1] ?? 0)), 0)
  if (!Number.isSafeInteger(previousNumber + 1)) fail('Could not generate an order reference.')
  const items = requestedItems.map(item => {
    const product = state.products.find(product => product.id === item.product_id)
    return { id: crypto.randomUUID(), product_id: product.id, product_name: product.name, sku: product.sku, quantity: Number(item.quantity), unit_price: product.price }
  })
  const order = {
    id, order_number: `INV-${String(previousNumber + 1).padStart(4, '0')}`, status: 'placed', total_amount: orderTotal(items),
    created_at: timestamp, completed_at: null, cancelled_at: null, items,
  }
  const quantities = new Map(items.map(item => [item.product_id, item.quantity]))
  const movements = items.map(item => {
    const product = state.products.find(product => product.id === item.product_id)
    return { id: crypto.randomUUID(), product_id: item.product_id, order_id: id, type: 'ORDER_PLACED', quantity_change: -item.quantity,
      previous_stock: product.stock_quantity, new_stock: product.stock_quantity - item.quantity,
      reason: `Order ${order.order_number} placed`, created_at: timestamp }
  })
  return {
    ...state, orders: [order, ...state.orders], movements: [...movements, ...state.movements],
    products: state.products.map(product => quantities.has(product.id) ? { ...product, stock_quantity: product.stock_quantity - quantities.get(product.id) } : product),
  }
}

function placedOrder(state, id) {
  const order = state.orders.find(order => order.id === id)
  if (!order) fail('This order could not be found.')
  if (order.status !== 'placed') fail(`Only placed orders can be changed. This order is ${order.status}.`)
  return order
}

export function completeOrder(state, id) {
  placedOrder(state, id)
  return { ...state, orders: state.orders.map(order => order.id === id ? { ...order, status: 'completed', completed_at: new Date().toISOString() } : order) }
}

export function cancelOrder(state, id) {
  const order = placedOrder(state, id)
  // Validate every restoration before changing any product or order.
  for (const item of order.items) {
    const product = state.products.find(product => product.id === item.product_id)
    if (!product || !Number.isSafeInteger(product.stock_quantity + item.quantity)) fail('Stock could not be restored. Check the product quantities and try again.')
  }
  const timestamp = new Date().toISOString()
  const quantities = new Map(order.items.map(item => [item.product_id, item.quantity]))
  const movements = order.items.map(item => {
    const product = state.products.find(product => product.id === item.product_id)
    return { id: crypto.randomUUID(), product_id: item.product_id, order_id: id, type: 'ORDER_CANCELLED', quantity_change: item.quantity,
      previous_stock: product.stock_quantity, new_stock: product.stock_quantity + item.quantity,
      reason: `Order ${order.order_number} cancelled`, created_at: timestamp }
  })
  return {
    ...state, orders: state.orders.map(item => item.id === id ? { ...item, status: 'cancelled', cancelled_at: timestamp } : item),
    products: state.products.map(product => quantities.has(product.id) ? { ...product, stock_quantity: product.stock_quantity + quantities.get(product.id) } : product),
    movements: [...movements, ...state.movements],
  }
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
const weekdayFormatter = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' })
export const formatOrderDate = (value, withTime = false) => new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}), timeZone: 'Asia/Kolkata',
}).format(new Date(value))

export function getRevenueSeries(orders, now = new Date()) {
  const today = dayFormatter.format(now)
  const series = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() - (6 - index))
    return { date: date.toISOString().slice(0, 10), label: weekdayFormatter.format(date), total: 0 }
  })
  for (const order of orders) {
    if (order.status !== 'completed') continue
    const bucket = series.find(day => day.date === dayFormatter.format(new Date(order.completed_at)))
    if (bucket) bucket.total = Math.round((bucket.total + order.total_amount) * 100) / 100
  }
  return series
}
