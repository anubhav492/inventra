import { useEffect, useState } from 'react'
import { ArrowDownUp, CheckCircle2, ClipboardList, Eye, IndianRupee, Package, Search, SearchX, ShoppingCart, X } from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import EmptyState from '../components/ui/EmptyState'
import OrderStatus from '../components/orders/OrderStatus'
import { formatCurrency } from '../utils/currency'
import { formatOrderDate, orderFilters, orderSorts } from '../utils/orders'
import { orderQuery } from '../services/business/orders'
import RemoteState from '../components/ui/RemoteState'
import Pagination from '../components/ui/Pagination'

export default function Orders({ catalog, onViewOrder, onCreateOrder }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const { loadOrders, loadSummary } = catalog
  const summary = catalog.summary.data
  const visibleOrders = catalog.orderList.data?.data ?? []
  const hasOrders = Boolean(query || filter !== 'all' || (catalog.summary.data?.total_orders ?? 0) > 0)
  useEffect(() => { const timer = setTimeout(() => { void loadOrders(orderQuery(query, filter, sort, 1)) }, 200); return () => clearTimeout(timer) }, [loadOrders, query, filter, sort])
  useEffect(() => { void loadSummary() }, [loadSummary])
  function resetFilters() { setQuery(''); setFilter('all'); setSort('newest') }
  return <div className="grid gap-6">
    <RemoteState resource={catalog.summary} onRetry={() => loadSummary()}><section className="inventory-summary-grid" aria-label="Order summary"><StatCard label="Total Orders" value={summary?.total_orders} helperText="Including cancelled orders" icon={ClipboardList} tone="indigo" /><StatCard label="Placed Orders" value={summary?.placed_orders} helperText="Awaiting completion" icon={ShoppingCart} tone="amber" /><StatCard label="Completed Orders" value={summary?.completed_orders} helperText="Successfully fulfilled" icon={CheckCircle2} tone="green" /><StatCard label="Completed Revenue" value={formatCurrency(summary?.total_revenue)} helperText="Completed orders only" icon={IndianRupee} tone="blue" /></section></RemoteState>
    <section className="panel min-w-0 overflow-hidden" aria-labelledby="orders-table-title">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6"><div><h2 id="orders-table-title">Customer orders</h2><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Track fulfillment from placement to completion.</p></div><span className="demo-label"><span />Saved to your account</span></div>
      <div className="flex flex-col gap-3 p-6 xl:flex-row xl:items-center"><div className="relative min-w-0 flex-1"><label htmlFor="order-search" className="sr-only">Search orders by ID</label><Search size={17} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><input id="order-search" type="search" className="catalog-control search-input" value={query} onChange={event => { setQuery(event.target.value) }} placeholder="Search order ID…" />{query && <button className="catalog-clear" aria-label="Clear order search" onClick={() => { setQuery('') }}><X size={15} /></button>}</div><div className="flex flex-col gap-3 sm:flex-row"><div className="sm:w-40"><label htmlFor="order-status" className="sr-only">Filter orders by status</label><select id="order-status" className="catalog-control" value={filter} onChange={event => { setFilter(event.target.value) }}>{orderFilters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="relative sm:w-48"><label htmlFor="order-sort" className="sr-only">Sort orders</label><ArrowDownUp size={15} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" /><select id="order-sort" className="catalog-control sort-input" value={sort} onChange={event => { setSort(event.target.value) }}>{orderSorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div></div>
      <RemoteState resource={catalog.orderList} onRetry={() => loadOrders()}><div className="table-scroll" role="region" tabIndex={0} aria-label="Customer orders table"><table className="orders-table"><caption className="sr-only">Orders matching your search, newest first by default</caption><thead><tr>{['Order ID', 'Date (IST)', 'Items', 'Total Amount', 'Status', 'Actions'].map(label => <th scope="col" key={label} className={label === 'Total Amount' ? 'numeric-cell' : undefined}>{label}</th>)}</tr></thead><tbody>{visibleOrders.map(order => <tr className="order-clickable-row" key={order.id} onClick={() => onViewOrder(order.id)}><td><button className="order-reference-button" onClick={event => { event.stopPropagation(); onViewOrder(order.id) }}>{order.id}</button></td><td><time dateTime={order.created_at}>{formatOrderDate(order.created_at)}</time></td><td><span className="flex items-center gap-2"><Package size={15} className="text-slate-400" />{order.item_count} {order.item_count === 1 ? 'product' : 'products'}</span></td><td className="amount">{formatCurrency(order.total_amount)}</td><td><OrderStatus status={order.status} /></td><td><button className="catalog-row-action restore-action" aria-label={`View details for ${order.id}`} onClick={event => { event.stopPropagation(); onViewOrder(order.id) }}><Eye size={15} />View Details</button></td></tr>)}</tbody></table></div>
      {!visibleOrders.length && <EmptyState icon={hasOrders ? SearchX : ShoppingCart} title={hasOrders ? 'No matching orders' : 'No orders yet'} description={hasOrders ? 'Try another order ID, or clear your filters.' : 'Create your first order to start tracking fulfillment. Stock changes will appear in inventory automatically.'} action={hasOrders ? <button className="secondary-button" onClick={resetFilters}>Clear filters</button> : <button className="secondary-button" onClick={onCreateOrder}>Create your first order</button>} />}
      <div className="catalog-footer"><span role="status">Showing {visibleOrders.length} {visibleOrders.length === 1 ? 'order' : 'orders'}</span><span>Prices in Indian Rupees (INR)</span></div>
      {catalog.orderList.data && <Pagination pagination={catalog.orderList.data.pagination} loading={catalog.orderList.loading} onPage={page => { void loadOrders(orderQuery(query, filter, sort, page)) }} />}
      </RemoteState>
    </section>
  </div>
}
