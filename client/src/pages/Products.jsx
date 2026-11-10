import { useEffect, useState } from 'react'
import { AlertTriangle, Archive, ArrowDownUp, CheckCircle2, Package, Pencil, RotateCcw, Search, SearchX, X } from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import StatusBadge from '../components/ui/StatusBadge'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import ProductForm from '../components/forms/ProductForm'
import { formatCurrency } from '../utils/currency'
import { getProductStatus, getProductSummary, statusOptions, sortOptions } from '../utils/products'
import { productQuery } from '../services/business/products'
import RemoteState from '../components/ui/RemoteState'

const badgeDetails = {
  'in-stock': ['In Stock', 'green'], 'low-stock': ['Low Stock', 'amber'], 'out-of-stock': ['Out of Stock', 'red'],
}

export default function Products({ catalog, form, onAdd, onEdit, onCloseForm, notify }) {
  const { products, handleCreate, handleUpdate, handleArchive, handleRestore } = catalog
  const { loadProducts, loadCatalog } = catalog
  useEffect(() => { void loadCatalog() }, [loadCatalog])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('name-asc')
  const [archiveId, setArchiveId] = useState(null)
  const summary = getProductSummary(products)
  const visibleProducts = catalog.productList.data ?? []
  useEffect(() => { const timer = setTimeout(() => { void loadProducts(productQuery(query, filter, sort)) }, 200); return () => clearTimeout(timer) }, [loadProducts, query, filter, sort])
  const selectedProduct = form?.mode === 'edit' && catalog.productDetail.data?.id === form.id ? catalog.productDetail.data : null
  const archiveTarget = products.find(product => product.id === archiveId)

  function resetFilters() { setQuery(''); setFilter('all'); setSort('name-asc') }

  async function handleSave(values) {
    if (selectedProduct) await handleUpdate(selectedProduct.id, values)
    else {
      await handleCreate(values)
      // Make the new record visible even if the previous view was Archived or a search.
      resetFilters()
    }
    onCloseForm()
    notify(selectedProduct ? 'Product details updated.' : 'Product added to your catalog.')
  }

  async function confirmArchive() {
    try { await handleArchive(archiveTarget.id); setArchiveId(null); notify(`${archiveTarget.name} archived. You can restore it from the Archived filter.`) }
    catch (error) { notify(error.message, 'error') }
  }

  return (
    <RemoteState resource={catalog.productList} onRetry={() => catalog.loadProducts()}><div className="grid gap-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="Product summary">
        <StatCard label="Total Products" value={summary.total} helperText="Non-archived catalog products" icon={Package} tone="indigo" />
        <StatCard label="Active Products" value={summary.active} helperText="Products with available stock" icon={CheckCircle2} tone="green" />
        <StatCard label="Low Stock" value={summary.lowStock} helperText="At or below their stock threshold" icon={AlertTriangle} tone="amber" />
      </section>

      <section className="panel min-w-0 overflow-hidden" aria-labelledby="catalog-title">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6">
          <div><h2 id="catalog-title">Product catalog</h2><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Keep your products organized and your stock in view.</p></div>
          <span className="demo-label"><span />Saved to your account</span>
        </div>
        <div className="flex flex-col gap-3 p-6 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="product-search" className="sr-only">Search products by name or SKU</label>
            <Search size={17} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
            <input id="product-search" className="catalog-control search-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by product name or SKU…" />
            {query && <button className="catalog-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={15} /></button>}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="min-w-0 sm:w-40"><label htmlFor="product-status" className="sr-only">Filter by status</label><select id="product-status" className="catalog-control" value={filter} onChange={event => setFilter(event.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="relative min-w-0 sm:w-48"><label htmlFor="product-sort" className="sr-only">Sort products</label><ArrowDownUp size={15} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" /><select id="product-sort" className="catalog-control sort-input" value={sort} onChange={event => setSort(event.target.value)}>{sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          </div>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Products table">
          <table className="product-table">
            <caption className="sr-only">Products matching the selected search, status and sort order</caption>
            <thead><tr><th scope="col">Product</th><th scope="col" className="numeric-cell">Price (INR)</th><th scope="col" className="numeric-cell">Stock</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
            <tbody>{visibleProducts.map(product => {
              const [label, tone] = badgeDetails[getProductStatus(product)]
              return <tr key={product.id}>
                <td><div className="flex items-center gap-3"><span className="product-thumbnail"><Package size={18} /></span><div><div className="product-name">{product.name}</div><div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400"><span>{product.sku}</span>{!product.is_active && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] dark:bg-slate-700">Archived</span>}</div></div></div></td>
                <td className="amount">{formatCurrency(product.price)}</td>
                <td className="numeric-cell"><span className="font-semibold tabular-nums">{product.stock_quantity}</span><span className="ml-1 text-slate-400">units</span></td>
                <td><StatusBadge tone={tone}>{label}</StatusBadge></td>
                <td><div className="flex items-center gap-2"><button className="catalog-row-action" disabled={catalog.pending || !product.is_active} title={!product.is_active ? 'Restore this product before editing' : undefined} onClick={() => onEdit(product.id)} aria-label={`Edit ${product.name}`}><Pencil size={14} />Edit</button>{product.is_active
                  ? <button className="catalog-row-action archive-action" disabled={catalog.pending} onClick={() => setArchiveId(product.id)} aria-label={`Archive ${product.name}`}><Archive size={14} />Archive</button>
                  : <button className="catalog-row-action restore-action" disabled={catalog.pending} onClick={async () => { try { await handleRestore(product.id); notify(`${product.name} restored. Find it under All Products.`) } catch (error) { notify(error.message, 'error') } }} aria-label={`Restore ${product.name}`}><RotateCcw size={14} />Restore</button>}</div></td>
              </tr>
            })}</tbody>
          </table>
        </div>
        {!visibleProducts.length && <EmptyState icon={SearchX}
          title={summary.total === 0 && filter === 'all' && !query ? 'Your catalog is empty' : filter === 'archived' && !query ? 'No archived products' : 'No matching products'}
          description={summary.total === 0 && filter === 'all' && !query ? 'Add your first product to start managing inventory, or use the Archived filter to restore an existing product.' : filter === 'archived' && !query ? 'Archived products will appear here. Their information is kept so you can restore them anytime.' : 'Try a different product name or SKU, or clear your filters to see the full catalog.'}
          action={summary.total === 0 && filter === 'all' && !query ? <button className="secondary-button" onClick={onAdd}>Add your first product</button> : <button className="secondary-button" onClick={resetFilters}>Clear filters</button>} />}
        <div className="catalog-footer"><span role="status">Showing {visibleProducts.length} {visibleProducts.length === 1 ? 'product' : 'products'}{query && ` matching “${query}”`}</span><span>{filter === 'archived' ? 'Archived products can be restored anytime' : 'Prices in Indian Rupees (INR)'}</span></div>
      </section>

      {form && <Modal title={form.mode === 'edit' ? 'Edit product' : 'Add product'} description={selectedProduct ? 'Update product details. Stock is managed separately in Inventory.' : 'Add a new item to your catalog. All prices are in Indian Rupees.'} onClose={onCloseForm}><RemoteState resource={form.mode === 'edit' ? catalog.productDetail : { data: true, loading: false, error: null }} onRetry={() => catalog.loadProduct(form.id)}><ProductForm key={selectedProduct?.id ?? 'new'} product={selectedProduct} products={products} onSave={handleSave} onCancel={onCloseForm} onError={message => notify(message, 'error')} /></RemoteState></Modal>}
      {archiveTarget && <Modal title="Archive product?" description={`Archive “${archiveTarget.name}” (${archiveTarget.sku})? It will be hidden from your active catalog and summary cards. All product information will be preserved.`} onClose={() => { if (!catalog.pending) setArchiveId(null) }}><div className="mb-6 flex items-start gap-3 rounded-lg bg-amber-50 p-4 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><Archive size={18} className="shrink-0" />You can restore this product at any time using the Archived filter.</div><div className="form-actions"><button type="button" className="secondary-button" autoFocus disabled={catalog.pending} onClick={() => setArchiveId(null)}>Cancel</button><button type="button" className="primary-button" disabled={catalog.pending} onClick={confirmArchive}>Archive product</button></div></Modal>}
    </div></RemoteState>
  )
}
