import { useId, useRef, useState } from 'react'
import { Info, IndianRupee } from 'lucide-react'
import { validateProductInput } from '../../services/business/products'

export default function ProductForm({ product, onSave, onCancel, onError }) {
  const isEditing = Boolean(product)
  const id = useId()
  const formRef = useRef(null)
  const submitLock = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [values, setValues] = useState(() => ({
    name: product?.name ?? '', sku: product?.sku ?? '', price: String(product?.price ?? ''),
    stock_quantity: String(product?.stock_quantity ?? ''),
    low_stock_threshold: String(product?.low_stock_threshold ?? 5),
  }))
  const [errors, setErrors] = useState({})

  function handleChange(event) {
    const { name, value } = event.target
    setValues(current => ({ ...current, [name]: value }))
    setErrors(current => ({ ...current, [name]: undefined }))
  }

  function showErrors(nextErrors) {
    setErrors(nextErrors)
    requestAnimationFrame(() => formRef.current?.elements.namedItem(Object.keys(nextErrors)[0])?.focus())
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitLock.current) return
    const nextErrors = validateProductInput(values, isEditing)
    if (Object.keys(nextErrors).length) { showErrors(nextErrors); return }
    submitLock.current = true
    setSubmitting(true)
    try {
      await onSave(values)
    } catch (error) {
      if (error.fields) showErrors(error.fields)
      else onError(error.message || 'Could not save this product. Please try again.')
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  function field(name, label, { type = 'text', placeholder, ...extra } = {}) {
    return (
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold" htmlFor={`${id}-${name}`}>{label} <span className="text-slate-400">{name === 'low_stock_threshold' ? '' : '*'}</span></label>
        <div className="relative">
          {name === 'price' && <IndianRupee size={15} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />}
          <input id={`${id}-${name}`} className={`catalog-control ${name === 'price' ? 'price-input' : ''}`}
            name={name} type={type} value={values[name]} placeholder={placeholder}
            onChange={handleChange} required disabled={submitting} aria-invalid={Boolean(errors[name])}
            aria-describedby={errors[name] ? `${id}-${name}-error` : undefined} {...extra} />
        </div>
        {errors[name] && <p id={`${id}-${name}-error`} className="text-xs text-rose-600 dark:text-rose-300" role="alert">{errors[name]}</p>}
      </div>
    )
  }

  return (
    <form ref={formRef} className="grid gap-5" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      {field('name', 'Product name', { placeholder: 'e.g. Wireless Mouse', autoFocus: true })}
      {field('sku', 'SKU', { placeholder: 'e.g. WM-001' })}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {field('price', 'Selling price (INR)', { type: 'number', min: '0', step: 'any', placeholder: '0.00' })}
        {isEditing ? <div className="flex flex-col gap-2"><span className="text-xs font-semibold">Current stock</span><div className="rounded-lg bg-slate-100 px-3 py-3 text-sm dark:bg-slate-700">{product.stock_quantity} units</div></div>
          : field('stock_quantity', 'Initial stock', { type: 'number', min: '0', step: '1', placeholder: '0' })}
      </div>
      {field('low_stock_threshold', 'Low stock threshold', { type: 'number', min: '0', step: '1' })}
      <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500 dark:bg-slate-900/50 dark:text-slate-400"><Info size={15} className="shrink-0" />{isEditing ? 'Stock quantities are managed through Inventory. Editing this product will keep its current stock unchanged.' : 'We’ll flag this product when stock reaches the low stock threshold. Required fields are marked *.'}</p>
      <div className="form-actions"><button className="secondary-button" type="button" disabled={submitting} onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Add product'}</button></div>
    </form>
  )
}
