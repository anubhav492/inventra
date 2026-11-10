import { useRef, useState } from 'react'
import { Check, Package, Plus, Search, ShoppingCart, Trash2 } from 'lucide-react'
import { formatCurrency } from '../../utils/currency'
import { lineTotal, orderTotal, validateOrderItems } from '../../utils/orders'

export default function OrderForm({ catalog, onSuccess, onCancel, notify }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const formRef = useRef(null)
  const available = catalog.products.filter(product => product.is_active && product.stock_quantity > 0)
  const search = query.trim().toLowerCase()
  const matching = available.filter(product => product.name.toLowerCase().includes(search) || product.sku.toLowerCase().includes(search))
  const rows = items.map(item => ({ ...item, product: catalog.products.find(product => product.id === item.product_id) }))
  const hasValidQuantities = rows.every(item => item.product && String(item.quantity).trim() !== '' && Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0)
  const summaryItems = hasValidQuantities ? rows.map(item => ({ unit_price: item.product.price, quantity: Number(item.quantity) })) : []
  const total = orderTotal(summaryItems)
  const units = summaryItems.reduce((sum, item) => sum + item.quantity, 0)

  function addProduct(product) {
    setItems(current => current.some(item => item.product_id === product.id) ? current : [...current, { product_id: product.id, quantity: '1' }])
    setErrors({})
  }
  function updateQuantity(id, quantity) {
    setItems(current => current.map(item => item.product_id === id ? { ...item, quantity } : item))
    setErrors(current => ({ ...current, [id]: undefined, form: undefined }))
  }
  function removeProduct(id) {
    setItems(current => current.filter(item => item.product_id !== id))
    setErrors({})
  }
  function showErrors(nextErrors) {
    setErrors(nextErrors)
    const key = Object.keys(nextErrors).find(key => key !== 'form')
    if (key) requestAnimationFrame(() => formRef.current?.elements.namedItem(`quantity-${key}`)?.focus())
  }
  async function handleSubmit(event) {
    event.preventDefault()
    if (submitLock.current) return
    const nextErrors = validateOrderItems(catalog.products, items)
    if (Object.keys(nextErrors).length) { showErrors(nextErrors); return }
    submitLock.current = true
    setSubmitting(true)
    try {
      // The backend validates ownership, prices and stock in one transaction.
      const order = await catalog.placeOrder(items)
      onSuccess(order)
    } catch (error) {
      showErrors(error.fields ?? { form: error.message || 'Could not place the order. Try again.' })
      notify?.(error.message || 'The order could not be confirmed. Refresh before retrying.', 'error')
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  return <form ref={formRef} className="grid gap-6" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
    <fieldset className="order-fieldset" disabled={submitting || catalog.catalog?.loading}>
      <legend className="sr-only">Select products and quantities</legend>
      <div className="grid gap-2"><label htmlFor="order-product-search" className="text-xs font-semibold">Find products</label><div className="relative"><Search size={17} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><input autoFocus id="order-product-search" className="catalog-control search-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search active products by name or SKU…" /></div></div>
      <div className="order-product-picker" role="region" aria-label="Available products">{matching.map(product => {
        const selected = items.some(item => item.product_id === product.id)
        return <div className="order-picker-row" key={product.id}><span className="product-thumbnail"><Package size={16} /></span><div className="min-w-0 flex-1"><strong className="block text-xs break-words">{product.name}</strong><span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{product.sku} · {product.stock_quantity} available · {formatCurrency(product.price)}</span></div><button type="button" className="catalog-row-action restore-action" disabled={selected} onClick={() => addProduct(product)} aria-label={selected ? `${product.name} selected` : `Add ${product.name} to order`}>{selected ? <Check size={15} /> : <Plus size={15} />}{selected ? 'Selected' : 'Add'}</button></div>
      })}{!matching.length && <div className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">{available.length ? 'No products match your search.' : 'No active products have available stock. Restock inventory or add a product first.'}</div>}</div>
      <div><div className="mb-3 flex items-center justify-between"><h3 className="m-0 text-sm font-semibold">Selected products</h3><span className="text-xs text-slate-500 dark:text-slate-400">{items.length} selected</span></div>
        {!rows.length ? <div className="order-empty-selection"><ShoppingCart size={26} /><p>Add products above to start this order.</p></div>
          : <div className="table-scroll"><table className="order-items-table"><thead><tr><th scope="col">Product</th><th scope="col" className="numeric-cell">Unit Price</th><th scope="col" className="numeric-cell">Available</th><th scope="col" className="numeric-cell">Quantity</th><th scope="col" className="numeric-cell">Line Total</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead><tbody>{rows.map(item => {
            const key = String(item.product_id)
            const validQuantity = String(item.quantity).trim() !== '' && Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0
            return <tr key={key}><td><strong className="product-name">{item.product?.name ?? 'Unavailable product'}</strong><p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{item.product?.sku}</p></td><td className="numeric-cell">{item.product ? formatCurrency(item.product.price) : '—'}</td><td className="numeric-cell">{item.product?.stock_quantity ?? 0}</td><td className="numeric-cell"><label className="sr-only" htmlFor={`order-quantity-${key}`}>Quantity for {item.product?.name}</label><input id={`order-quantity-${key}`} name={`quantity-${key}`} className="catalog-control order-quantity" type="number" min="1" max={item.product?.stock_quantity} step="1" value={item.quantity} onChange={event => updateQuantity(item.product_id, event.target.value)} required aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `order-error-${key}` : undefined} />{errors[key] && <p id={`order-error-${key}`} className="order-field-error" role="alert">{errors[key]}</p>}</td><td className="amount">{item.product && validQuantity ? formatCurrency(lineTotal(item.product.price, Number(item.quantity))) : '—'}</td><td><button type="button" className="catalog-row-action" aria-label={`Remove ${item.product?.name ?? 'product'} from order`} onClick={() => removeProduct(item.product_id)}><Trash2 size={16} /></button></td></tr>
          })}</tbody></table></div>}
      </div>
    </fieldset>
    <div className="order-summary-box" aria-live="polite"><div className="flex flex-wrap justify-between gap-3 text-xs text-slate-500 dark:text-slate-400"><span>{items.length} distinct products · {hasValidQuantities ? units : '—'} total units</span><span>INR · No additional charges</span></div><div className="mt-4 flex justify-between text-sm"><span>Subtotal</span><strong>{hasValidQuantities ? formatCurrency(total) : '—'}</strong></div><div className="order-grand-total"><span>Grand Total</span><strong>{hasValidQuantities ? formatCurrency(total) : '—'}</strong></div></div>
    {errors.form && <p className="order-field-error" role="alert">{errors.form}</p>}
    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">Placing an order deducts stock immediately. Prices and product details are saved with the order.</p>
    <div className="form-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={submitting}>Cancel</button><button className="primary-button" type="submit" disabled={submitting || !items.length}>{submitting ? 'Placing order…' : 'Place Order'}</button></div>
  </form>
}
