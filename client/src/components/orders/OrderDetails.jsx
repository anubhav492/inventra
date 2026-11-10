import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import Modal from '../ui/Modal'
import OrderStatus from './OrderStatus'
import { formatCurrency } from '../../utils/currency'
import { formatOrderDate, orderUnits } from '../../utils/orders'

export default function OrderDetails({ order, catalog, onClose, notify }) {
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const submitLock = useRef(false)
  const keepOrderRef = useRef(null)
  const confirmation = order.status === 'placed' ? confirming : false
  useEffect(() => { if (confirming) keepOrderRef.current?.focus() }, [confirming])

  async function applyAction(action) {
    if (submitLock.current) return
    submitLock.current = true
    setSubmitting(true)
    setError('')
    try {
      if (action === 'cancel') await catalog.cancelOrder(order.id)
      else await catalog.completeOrder(order.id)
      onClose()
      notify(action === 'cancel' ? `${order.id} cancelled. Stock restored.` : `${order.id} completed.`)
    } catch (failure) {
      setError(failure.message || 'Could not update the order. Please try again.')
      notify(failure.message || 'Could not update the order. Please try again.', 'error')
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  return <Modal wide title={confirmation === 'complete' ? 'Complete order?' : confirmation ? 'Cancel order?' : `Order ${order.id}`}
    description={confirmation === 'complete' ? 'Confirm that this order has been fulfilled.' : confirmation ? 'Review the quantities that will be returned to inventory.' : 'Order details and prices are preserved from the time of purchase.'}
    onClose={() => { if (!submitLock.current) onClose() }}>
    {confirmation ? <div className="grid gap-5">
      <div className="order-cancel-warning"><AlertTriangle size={22} className="shrink-0" /><p>{confirmation === 'complete' ? 'Completed orders become read-only and cannot be cancelled. Stock has already been deducted and will not change again.' : 'Cancelling this order will restore the purchased quantities to inventory. This action cannot be undone.'}</p></div>
      <div className="order-summary-box grid gap-3 text-sm"><div className="flex justify-between"><span>Order</span><strong>{order.id}</strong></div><div className="flex justify-between"><span>Products</span><strong>{order.items.length}</strong></div><div className="flex justify-between"><span>{confirmation === 'complete' ? 'Units fulfilled' : 'Units to restore'}</span><strong>{orderUnits(order)}</strong></div></div>
      {error && <p className="order-field-error" role="alert">{error}</p>}
      <div className="form-actions"><button ref={keepOrderRef} className="secondary-button" disabled={submitting} onClick={() => { setConfirming(false); setError('') }}>{confirmation === 'complete' ? 'Back to details' : 'Keep Order'}</button><button className={confirmation === 'complete' ? 'primary-button' : 'order-danger-button'} disabled={submitting} onClick={() => applyAction(confirmation)}>{submitting ? 'Updating…' : confirmation === 'complete' ? 'Confirm Completion' : 'Confirm Cancellation'}</button></div>
    </div> : <div className="grid gap-6" aria-busy={submitting}>
      <div className="grid grid-cols-1 gap-4 rounded-lg bg-slate-50 p-4 text-xs sm:grid-cols-2 dark:bg-slate-900/60"><div><span className="text-slate-500 dark:text-slate-400">Order reference</span><strong className="mt-1 block">{order.id}</strong></div><div><span className="mb-1 block text-slate-500 dark:text-slate-400">Status</span><OrderStatus status={order.status} /></div><div><span className="text-slate-500 dark:text-slate-400">Created (IST)</span><time className="mt-1 block" dateTime={order.created_at}>{formatOrderDate(order.created_at, true)}</time></div>{(order.completed_at || order.cancelled_at) && <div><span className="text-slate-500 dark:text-slate-400">{order.completed_at ? 'Completed' : 'Cancelled'} (IST)</span><time className="mt-1 block" dateTime={order.completed_at ?? order.cancelled_at}>{formatOrderDate(order.completed_at ?? order.cancelled_at, true)}</time></div>}</div>
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Order purchased products"><table className="order-items-table"><caption className="sr-only">Purchased products and historical prices</caption><thead><tr><th scope="col">Product</th><th scope="col" className="numeric-cell">Quantity</th><th scope="col" className="numeric-cell">Unit Price</th><th scope="col" className="numeric-cell">Line Total</th></tr></thead><tbody>{order.items.map(item => <tr key={item.id}><td><strong className="product-name">{item.product_name}</strong><p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{item.sku}</p></td><td className="numeric-cell">{item.quantity}</td><td className="numeric-cell">{formatCurrency(item.unit_price)}</td><td className="amount">{formatCurrency(item.line_total)}</td></tr>)}</tbody></table></div>
      <div className="order-summary-box"><div className="flex flex-wrap justify-between gap-3 text-xs text-slate-500 dark:text-slate-400"><span>{order.items.length} distinct products</span><span>{orderUnits(order)} total units</span></div><div className="order-grand-total"><span>Grand Total</span><strong>{formatCurrency(order.total_amount)}</strong></div></div>
      {error && <p className="order-field-error" role="alert">{error}</p>}
      {order.status === 'placed' ? <div className="flex flex-wrap items-center justify-between gap-3"><button className="order-danger-button" disabled={submitting} onClick={() => setConfirming('cancel')}>Cancel Order</button><button className="primary-button" disabled={submitting} onClick={() => setConfirming('complete')}><CheckCircle2 size={16} />Mark as Completed</button></div>
        : <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500 dark:text-slate-400">{order.status === 'completed' ? 'Completed orders are read-only and cannot be cancelled.' : 'Stock has been restored. Cancelled orders are read-only.'}</p><button className="secondary-button" onClick={onClose}>Close</button></div>}
    </div>}
  </Modal>
}
