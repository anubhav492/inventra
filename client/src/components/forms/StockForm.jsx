import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, Info, Package } from 'lucide-react'
import { adjustmentReasons, signedQuantity } from '../../utils/inventory'
import { stockPayload } from '../../services/business/inventory'

export default function StockForm({ mode, initialProductId, catalog, onSave, onCancel }) {
  const adjusting = mode === 'adjust'
  const id = useId()
  const formRef = useRef(null)
  const confirmRef = useRef(null)
  const submitLock = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [values, setValues] = useState({ product_id: initialProductId == null ? '' : String(initialProductId), quantity: '', reason: '', note: '' })
  const [errors, setErrors] = useState({})
  const [review, setReview] = useState(null)
  const activeProducts = catalog.products.filter(product => product.is_active)
  const product = catalog.products.find(item => String(item.id) === values.product_id)
  const quantity = Number(values.quantity)
  const validQuantity = values.quantity.trim() !== '' && Number.isInteger(quantity) && quantity !== 0 && quantity >= (adjusting ? -2147483648 : 1) && quantity <= 2147483647
  const nextStock = product && validQuantity ? product.stock_quantity + quantity : null
  const validPreview = nextStock !== null && Number.isSafeInteger(nextStock)

  useEffect(() => { if (review) confirmRef.current?.focus() }, [review])

  function handleChange(event) {
    const { name, value } = event.target
    setValues(current => ({ ...current, [name]: value, ...(name === 'product_id' ? { quantity: '' } : {}), ...(name === 'reason' ? { note: '' } : {}) }))
    setErrors({})
  }

  function showErrors(nextErrors) {
    setErrors(nextErrors)
    setReview(null)
    requestAnimationFrame(() => formRef.current?.elements.namedItem(Object.keys(nextErrors)[0])?.focus())
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitLock.current) return
    const payload = review ?? values
    const nextErrors = {}
    if (!product?.is_active) nextErrors.product_id = 'Select an active product.'
    try { stockPayload(payload, adjusting) } catch (error) { nextErrors.form = error.message }
    if (product && product.stock_quantity + Number(payload.quantity) < 0) nextErrors.quantity = 'This change would make stock negative.'
    if (Object.keys(nextErrors).length) { showErrors(nextErrors); return }
    if (adjusting && !review) { setReview({ ...values, expected_stock: product.stock_quantity }); return }
    submitLock.current = true
    setSubmitting(true)
    try {
      const operation = adjusting ? catalog.adjustStock : catalog.restockProduct
      await operation(product.id, payload)
      onSave(product, adjusting)
    } catch (error) {
      showErrors(error.fields ?? { form: error.message || 'Could not update stock. Please try again.' })
    } finally { submitLock.current = false; setSubmitting(false) }
  }

  function fieldError(field) {
    return errors[field] && <p id={`${id}-${field}-error`} className="text-xs text-rose-600 dark:text-rose-300" role="alert">{errors[field]}</p>
  }
  function accessibility(field) {
    return { 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${id}-${field}-error` : undefined }
  }

  if (!activeProducts.length) return <div className="grid gap-5 text-sm"><p className="text-slate-500 dark:text-slate-400">There are no active products available. Add or restore a product before restocking.</p><a href="#products" className="primary-button" onClick={onCancel}>Go to Products</a></div>

  return (
    <form ref={formRef} className="grid gap-5" onSubmit={handleSubmit} noValidate aria-busy={submitting}><fieldset className="order-fieldset" disabled={submitting}>
      {review ? <>
        <div className="inventory-info-box"><CheckCircle2 size={20} /><div><strong>Review stock adjustment</strong><p>Confirm this correction before it is applied.</p></div></div>
        <div className="grid gap-4 rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-900/60">
          <div><strong className="break-words">{product.name}</strong><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{product.sku}</p></div>
          <div className="flex items-center justify-between"><span>Current stock</span><strong>{review.expected_stock} units</strong></div>
          <div className="flex items-center justify-between"><span>New actual stock</span><strong>{review.expected_stock + Number(review.quantity)} units</strong></div>
          <div className="flex items-center justify-between"><span>Difference</span><strong className={Number(review.quantity) < 0 ? 'inventory-negative' : 'inventory-positive'}>{signedQuantity(Number(review.quantity))} units</strong></div>
          <div><span className="text-xs text-slate-500 dark:text-slate-400">Reason</span><p className="mt-1 break-words">{review.reason === 'Other' ? review.note : review.reason}</p></div>
        </div>
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">The server applies this signed change to current stock and records a movement. The preview may change if another operation updates stock.</p>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setReview(null)}>Back</button><button ref={confirmRef} className="primary-button" type="submit">Confirm adjustment</button></div>
      </> : <>
        {initialProductId == null ? <div className="grid gap-2"><label className="text-xs font-semibold" htmlFor={`${id}-product`}>Product *</label><select id={`${id}-product`} name="product_id" className="catalog-control" value={values.product_id} onChange={handleChange} required autoFocus {...accessibility('product_id')}><option value="">Select a product</option>{activeProducts.map(item => <option key={item.id} value={String(item.id)}>{item.name} · {item.sku}</option>)}</select>{fieldError('product_id')}</div>
          : <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-4 dark:bg-slate-900/60"><span className="product-thumbnail"><Package size={20} /></span><div className="min-w-0"><strong className="text-sm break-words">{product?.name}</strong><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{product?.sku}</p></div></div>}
        {initialProductId != null && fieldError('product_id')}
        <div className="flex items-center justify-between text-sm"><span className="text-slate-500 dark:text-slate-400">Current stock</span><strong>{product ? `${product.stock_quantity} units` : 'Select a product'}</strong></div>
        <div className="grid gap-2"><label className="text-xs font-semibold" htmlFor={`${id}-quantity`}>{adjusting ? 'Quantity change (+ or ?)' : 'Quantity to add'} *</label><input id={`${id}-quantity`} className="catalog-control" type="number" name="quantity" value={values.quantity} onChange={handleChange} min={adjusting ? '-2147483648' : '1'} step="1" placeholder={adjusting ? 'e.g. -2 for damaged units' : 'Enter units received'} required autoFocus={initialProductId != null} {...accessibility('quantity')} />{fieldError('quantity')}</div>
        {adjusting && <div className="grid gap-2"><label className="text-xs font-semibold" htmlFor={`${id}-reason`}>Adjustment reason *</label><select id={`${id}-reason`} name="reason" className="catalog-control" value={values.reason} onChange={handleChange} required {...accessibility('reason')}><option value="">Choose a reason</option>{adjustmentReasons.map(reason => <option key={reason}>{reason}</option>)}</select>{fieldError('reason')}</div>}
        {(!adjusting || values.reason === 'Other') && <div className="grid gap-2"><label className="text-xs font-semibold" htmlFor={`${id}-note`}>{adjusting ? 'Explanation *' : 'Note (optional)'}</label><input id={`${id}-note`} className="catalog-control" name="note" value={values.note} onChange={handleChange} placeholder={adjusting ? 'Explain the stock correction' : 'e.g. New shipment received'} maxLength={200} required={adjusting} {...accessibility('note')} />{fieldError('note')}</div>}
        <div className="inventory-preview" aria-live="polite"><div><span className="text-xs text-slate-500 dark:text-slate-400">Updated stock preview</span><div className="mt-2 flex items-center gap-3 text-lg font-semibold"><span>{product?.stock_quantity ?? '—'}</span><ArrowRight size={17} className="text-slate-400" /><span>{validPreview ? nextStock : '—'} <span className="text-xs font-normal">units</span></span></div></div>{validPreview && <strong className={nextStock - product.stock_quantity < 0 ? 'inventory-negative' : 'inventory-positive'}>{signedQuantity(nextStock - product.stock_quantity)}</strong>}</div>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400"><Info size={15} className="shrink-0" />{adjusting ? 'Corrections can increase or decrease stock. You will review and confirm the difference before applying it.' : 'Only stock quantities change. Product prices and other details stay the same.'}</p>
        {fieldError('form')}
        <div className="form-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">{adjusting ? 'Review adjustment' : 'Restock product'}</button></div>
      </>}
    </fieldset></form>
  )
}
