import test from 'node:test'
import assert from 'node:assert/strict'
import { initialProducts } from '../data/products.js'
import { formatCurrency } from './currency.js'
import { createProduct, updateProduct, setProductActive, validateProduct, getProductStatus, getProductSummary, selectProducts, sortOptions } from './products.js'

const values = { name: 'Travel Charger', sku: 'TC-100', price: '999.50', stock_quantity: '10', low_stock_threshold: '5' }

test('summary excludes archived products and separates low stock from empty stock', () => {
  assert.deepEqual(getProductSummary(initialProducts), { total: 11, active: 9, lowStock: 4 })
  assert.equal(getProductStatus({ stock_quantity: 0, low_stock_threshold: 0 }), 'out-of-stock')
  assert.equal(getProductStatus({ stock_quantity: 5, low_stock_threshold: 5 }), 'low-stock')
  assert.equal(getProductStatus({ stock_quantity: 1, low_stock_threshold: 0 }), 'in-stock')
})

test('search is case-insensitive and composes with every filter', () => {
  assert.equal(selectProducts(initialProducts, '  wireless MOUSE ', 'all', 'name-asc')[0].sku, 'WM-001')
  assert.equal(selectProducts(initialProducts, 'mk-002', 'low-stock', 'price-desc')[0].name, 'Mechanical Keyboard')
  assert.equal(selectProducts(initialProducts, 'mk-002', 'in-stock', 'price-desc').length, 0)
  assert.equal(selectProducts(initialProducts, 'mouse', 'archived', 'name-asc')[0].sku, 'OM-012')
  assert.equal(selectProducts(initialProducts, 'not a product', 'all', 'name-asc').length, 0)
  for (const status of ['in-stock', 'low-stock', 'out-of-stock']) {
    const result = selectProducts(initialProducts, '', status, 'name-asc')
    assert.ok(result.length)
    assert.ok(result.every(product => product.is_active && getProductStatus(product) === status))
  }
  assert.ok(selectProducts(initialProducts, '', 'all', 'name-asc').every(product => product.is_active))
})

test('all six sort directions work without mutating the collection', () => {
  const snapshot = structuredClone(initialProducts)
  for (const [sort] of sortOptions) {
    const result = selectProducts(initialProducts, '', 'all', sort)
    const [field, direction] = sort.split('-')
    for (let i = 1; i < result.length; i++) {
      const previous = result[i - 1], current = result[i]
      const comparison = field === 'name' ? previous.name.localeCompare(current.name, 'en-IN', { sensitivity: 'base' })
        : field === 'price' ? previous.price - current.price : previous.stock_quantity - current.stock_quantity
      assert.ok(direction === 'asc' ? comparison <= 0 : comparison >= 0, sort)
    }
  }
  assert.deepEqual(initialProducts, snapshot)
})

test('validation rejects blank names/SKUs and duplicate active or archived SKUs', () => {
  assert.ok(validateProduct({ ...values, name: '  ', sku: ' ' }, initialProducts).name)
  assert.ok(validateProduct({ ...values, sku: '' }, initialProducts).sku)
  for (const sku of [' wm-001 ', 'om-012']) assert.ok(validateProduct({ ...values, sku }, initialProducts).sku)
  const sameProduct = { ...initialProducts[0] }
  assert.deepEqual(validateProduct(sameProduct, initialProducts, sameProduct.id), {})
  assert.ok(validateProduct({ ...sameProduct, sku: 'MK-002' }, initialProducts, sameProduct.id).sku)
})

test('price, stock, and threshold enforce their numeric boundaries', () => {
  for (const price of ['', ' ', '-1', 'NaN', 'Infinity', 'abc']) assert.ok(validateProduct({ ...values, price }, initialProducts).price)
  for (const field of ['stock_quantity', 'low_stock_threshold']) {
    for (const number of ['', ' ', '-1', '1.5', 'Infinity', 'abc', '9007199254740992']) {
      assert.ok(validateProduct({ ...values, [field]: number }, initialProducts)[field], `${field}: ${number}`)
    }
  }
  assert.deepEqual(validateProduct({ ...values, price: '0', stock_quantity: '0', low_stock_threshold: '0' }, initialProducts), {})
})

test('create normalizes values, generates unique IDs, and updates derived metrics', () => {
  const snapshot = structuredClone(initialProducts)
  const created = createProduct(initialProducts, { ...values, name: ' Travel Charger ', sku: ' TC-100 ' })
  const product = created.at(-1)
  assert.equal(product.name, values.name)
  assert.equal(product.sku, values.sku)
  assert.equal(product.price, 999.5)
  assert.equal(product.stock_quantity, 10)
  assert.equal(product.is_active, true)
  assert.ok(!Number.isNaN(Date.parse(product.created_at)))
  assert.notEqual(createProduct(initialProducts, values).at(-1).id, product.id)
  assert.deepEqual(getProductSummary(created), { total: 12, active: 10, lowStock: 4 })
  assert.throws(() => createProduct(created, values), error => Boolean(error.fields.sku))
  assert.deepEqual(initialProducts, snapshot)
})

test('edit preserves stock, created time and archive state, even if a stock field is supplied', () => {
  const original = initialProducts[1]
  const edited = updateProduct(initialProducts, original.id, { ...original, name: 'Updated Keyboard', price: '1999', stock_quantity: '999', low_stock_threshold: '2' })
  const product = edited.find(item => item.id === original.id)
  assert.equal(product.name, 'Updated Keyboard')
  assert.equal(product.price, 1999)
  assert.equal(product.stock_quantity, original.stock_quantity)
  assert.equal(product.created_at, original.created_at)
  assert.equal(product.is_active, original.is_active)
  assert.equal(getProductSummary(edited).lowStock, 3)
  assert.equal(initialProducts[1].name, 'Mechanical Keyboard')
})

test('archive and restore preserve records and update views and metrics', () => {
  const original = initialProducts[1]
  const archived = setProductActive(initialProducts, original.id, false)
  assert.equal(archived.length, initialProducts.length)
  assert.deepEqual(archived[1], { ...original, is_active: false })
  assert.equal(selectProducts(archived, original.sku, 'all', 'name-asc').length, 0)
  assert.equal(selectProducts(archived, original.sku, 'archived', 'name-asc').length, 1)
  assert.deepEqual(getProductSummary(archived), { total: 10, active: 8, lowStock: 3 })
  const restored = setProductActive(archived, original.id, true)
  assert.deepEqual(restored, initialProducts)
})

test('currency formatting uses INR and Indian grouping without exchange-rate conversion', () => {
  assert.equal(formatCurrency(84320), '₹84,320.00')
  assert.equal(formatCurrency(123456.5), '₹1,23,456.50')
  assert.equal(formatCurrency(0), '₹0.00')
  assert.equal(formatCurrency(799), '₹799.00')
})
