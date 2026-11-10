export const statusOptions = [
  ['all', 'All Products'], ['in-stock', 'In Stock'], ['low-stock', 'Low Stock'],
  ['out-of-stock', 'Out of Stock'], ['archived', 'Archived'],
]

export const sortOptions = [
  ['name-asc', 'Name A–Z'], ['name-desc', 'Name Z–A'],
  ['price-asc', 'Price Low–High'], ['price-desc', 'Price High–Low'],
  ['stock-asc', 'Stock Low–High'], ['stock-desc', 'Stock High–Low'],
]

export function getProductStatus(product) {
  if (product.stock_quantity === 0) return 'out-of-stock'
  return product.stock_quantity <= product.low_stock_threshold ? 'low-stock' : 'in-stock'
}

export function getProductSummary(products) {
  const available = products.filter(product => product.is_active)
  return {
    total: available.length,
    active: available.filter(product => product.stock_quantity > 0).length,
    lowStock: available.filter(product => getProductStatus(product) === 'low-stock').length,
  }
}

export function selectProducts(products, query, status, sort) {
  const search = query.trim().toLowerCase()
  const result = products.filter(product => {
    const matchesStatus = status === 'archived' ? !product.is_active
      : product.is_active && (status === 'all' || getProductStatus(product) === status)
    return matchesStatus && (product.name.toLowerCase().includes(search) || product.sku.toLowerCase().includes(search))
  })
  const [field, direction] = sort.split('-')
  const multiplier = direction === 'desc' ? -1 : 1
  return result.sort((a, b) => {
    const comparison = field === 'price' ? a.price - b.price
      : field === 'stock' ? a.stock_quantity - b.stock_quantity
        : a.name.localeCompare(b.name, 'en-IN', { sensitivity: 'base' })
    return comparison * multiplier || a.name.localeCompare(b.name)
  })
}

export function validateProduct(values, products, editingId = null) {
  const errors = {}
  if (!values.name.trim()) errors.name = 'Enter a product name.'
  if (!values.sku.trim()) errors.sku = 'Enter a SKU.'
  else if (products.some(product => product.id !== editingId && product.sku.trim().toLowerCase() === values.sku.trim().toLowerCase())) {
    errors.sku = 'This SKU is already used by another product, including archived products.'
  }
  const price = Number(values.price)
  if (String(values.price).trim() === '' || !Number.isFinite(price) || price < 0 || price > Number.MAX_SAFE_INTEGER) {
    errors.price = 'Enter a valid price of zero or more in INR.'
  }
  for (const field of editingId === null ? ['stock_quantity', 'low_stock_threshold'] : ['low_stock_threshold']) {
    const value = Number(values[field])
    if (String(values[field]).trim() === '' || !Number.isSafeInteger(value) || value < 0) {
      errors[field] = 'Enter a whole number of zero or more.'
    }
  }
  return errors
}

function validatedDetails(values, products, editingId = null) {
  const errors = validateProduct(values, products, editingId)
  if (Object.keys(errors).length) {
    const error = new Error('Please check the highlighted fields.')
    error.fields = errors
    throw error
  }
  return { name: values.name.trim(), sku: values.sku.trim(), price: Number(values.price), low_stock_threshold: Number(values.low_stock_threshold) }
}

export function createProduct(products, values) {
  const details = validatedDetails(values, products)
  return [...products, {
    ...details, id: crypto.randomUUID(), stock_quantity: Number(values.stock_quantity),
    is_active: true, created_at: new Date().toISOString(),
  }]
}

export function updateProduct(products, id, values) {
  const details = validatedDetails(values, products, id)
  return products.map(product => product.id === id ? { ...product, ...details } : product)
}

export function setProductActive(products, id, isActive) {
  return products.map(product => product.id === id ? { ...product, is_active: isActive } : product)
}
