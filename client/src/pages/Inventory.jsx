import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownUp, Boxes, CircleAlert, IndianRupee, Package, PackagePlus, Search, SearchX, SlidersHorizontal, X } from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import StockForm from '../components/forms/StockForm'
import StockLevel, { StockStatus } from '../components/inventory/StockLevel'
import InventoryAlerts from '../components/inventory/InventoryAlerts'
import StockMovementHistory from '../components/inventory/StockMovementHistory'
import { formatCurrency } from '../utils/currency'
import { sortOptions } from '../utils/products'
import { inventoryFilters } from '../utils/inventory'
import { inventoryQuery } from '../services/business/inventory'
import RemoteState from '../components/ui/RemoteState'

export default function Inventory({ catalog, dialog, onOpenDialog, onCloseDialog, notify }) {
  const { products, loadInventory, loadAlerts, loadCatalog, loadSummary } = catalog
  useEffect(() => { void loadCatalog() }, [loadCatalog])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('name-asc')
  const tableRef = useRef(null)
  const summary = catalog.summary.data
  useEffect(() => { void loadSummary() }, [loadSummary])
  const visibleProducts = catalog.inventoryList.data ?? []
  useEffect(() => { const timer = setTimeout(() => { void loadInventory(inventoryQuery(query, filter, sort)) }, 200); return () => clearTimeout(timer) }, [loadInventory, query, filter, sort])
  useEffect(() => { void loadAlerts() }, [loadAlerts])
  const hasInventory = products.some(product => product.is_active)

  function resetFilters() { setQuery(''); setFilter('all'); setSort('name-asc') }
  function viewLowStock() {
    setQuery('')
    setFilter('low-stock')
    setSort('stock-asc')
    tableRef.current?.scrollIntoView({ block: 'start' })
    document.getElementById('inventory-status')?.focus({ preventScroll: true })
  }

  return (
    <div className="grid gap-6">
      <RemoteState resource={catalog.summary} onRetry={() => loadSummary()}><section className="inventory-summary-grid" aria-label="Inventory summary">
        <StatCard label="Total Stock Units" value={summary ? BigInt(summary.total_stock_units).toLocaleString('en-IN') : ''} helperText="Across all active products" icon={Boxes} tone="indigo" />
        <StatCard label="Inventory Value (Selling Price)" value={formatCurrency(summary?.total_inventory_value)} helperText="Selling price × available units" icon={IndianRupee} tone="blue" />
        <StatCard label="Low Stock Products" value={summary?.low_stock_count} helperText="At or below their stock threshold" icon={AlertTriangle} tone="amber" />
        <StatCard label="Out of Stock" value={summary?.out_of_stock_count} helperText="Products with no available units" icon={CircleAlert} tone="red" />
      </section></RemoteState>

      <RemoteState resource={catalog.alerts} onRetry={() => loadAlerts()}><InventoryAlerts products={products} alerts={catalog.alerts.data ?? []} onRestock={id => onOpenDialog({ mode: 'restock', id })} onViewLowStock={viewLowStock} /></RemoteState>

      <RemoteState resource={catalog.inventoryList} onRetry={() => loadInventory()}><section ref={tableRef} className="panel min-w-0 overflow-hidden" aria-labelledby="inventory-table-title">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6"><div><h2 id="inventory-table-title">Stock overview</h2><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Live stock levels from your shared product catalog.</p></div><span className="demo-label"><span />Saved to your account</span></div>
        <div className="flex flex-col gap-3 p-6 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1"><label htmlFor="inventory-search" className="sr-only">Search inventory by name or SKU</label><Search size={17} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><input id="inventory-search" type="search" className="catalog-control search-input" placeholder="Search by product name or SKU…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="catalog-clear" aria-label="Clear inventory search" onClick={() => setQuery('')}><X size={15} /></button>}</div>
          <div className="flex flex-col gap-3 sm:flex-row"><div className="sm:w-44"><label className="sr-only" htmlFor="inventory-status">Filter inventory by status</label><select id="inventory-status" className="catalog-control" value={filter} onChange={event => setFilter(event.target.value)}>{inventoryFilters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="relative sm:w-52"><label className="sr-only" htmlFor="inventory-sort">Sort inventory</label><ArrowDownUp size={15} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" /><select id="inventory-sort" className="catalog-control sort-input" value={sort} onChange={event => setSort(event.target.value)}>{sortOptions.map(([value, label]) => <option key={value} value={value}>{value.startsWith('name-') ? `Product ${label}` : label}</option>)}</select></div></div>
        </div>
        <div className="table-scroll" role="region" tabIndex={0} aria-label="Inventory stock table"><table className="inventory-table"><caption className="sr-only">Active products and their current stock levels</caption><thead><tr>{['Product', 'Unit Price (INR)', 'Current Stock', 'Low Stock Threshold', 'Stock Status', 'Actions'].map(label => <th scope="col" key={label} className={['Unit Price (INR)', 'Current Stock', 'Low Stock Threshold'].includes(label) ? 'numeric-cell' : undefined}>{label}</th>)}</tr></thead><tbody>{visibleProducts.map(product => <tr key={product.id}>
          <td><div className="flex items-center gap-3"><span className="product-thumbnail"><Package size={18} /></span><div><div className="product-name">{product.name}</div><div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{product.sku}</div></div></div></td>
          <td className="amount">{formatCurrency(product.price)}</td>
          <td className="numeric-cell"><strong className="tabular-nums">{product.stock_quantity}</strong><span className="ml-1 text-slate-400">units</span><StockLevel product={product} /></td>
          <td className="numeric-cell">{product.low_stock_threshold}<span className="ml-1 text-slate-400">units</span></td>
          <td><StockStatus product={product} /></td>
          <td><div className="flex items-center gap-1"><button className="catalog-row-action restore-action" onClick={() => onOpenDialog({ mode: 'restock', id: product.id })} aria-label={`Restock ${product.name}`}><PackagePlus size={14} />Restock</button><button className="catalog-row-action" onClick={() => onOpenDialog({ mode: 'adjust', id: product.id })} aria-label={`Adjust stock for ${product.name}`}><SlidersHorizontal size={14} />Adjust Stock</button></div></td>
        </tr>)}</tbody></table></div>
        {!visibleProducts.length && <EmptyState icon={hasInventory ? SearchX : Boxes} title={hasInventory ? 'No matching inventory' : 'No active inventory yet'} description={hasInventory ? 'Try another product name or SKU, or clear your filters to see all active stock.' : 'Add a product or restore an archived product to start managing its stock.'} action={hasInventory ? <button className="secondary-button" onClick={resetFilters}>Clear filters</button> : <a className="secondary-button" href="#products">Go to Products</a>} />}
        <div className="catalog-footer"><span role="status">Showing {visibleProducts.length} active {visibleProducts.length === 1 ? 'product' : 'products'}</span><span>Stock bars show a reference level, not maximum capacity</span></div>
      </section></RemoteState>

      <StockMovementHistory products={products} catalog={catalog} />

      {dialog && <Modal title={dialog.mode === 'adjust' ? 'Adjust stock' : 'Restock product'} description={dialog.mode === 'adjust' ? 'Correct a stock discrepancy and record why it changed.' : 'Record received units and keep your stock up to date.'} onClose={onCloseDialog}><StockForm key={`${dialog.mode}-${dialog.id ?? 'select'}`} mode={dialog.mode} initialProductId={dialog.id} catalog={catalog} onCancel={onCloseDialog} onSave={(product, adjusting) => {
        onCloseDialog()
        notify(adjusting ? `Stock adjusted for ${product.name}. Movement recorded.` : `${product.name} restocked. Movement recorded.`)
      }} /></Modal>}
    </div>
  )
}
