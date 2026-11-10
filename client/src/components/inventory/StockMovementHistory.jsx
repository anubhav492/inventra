import { useEffect, useState } from 'react'
import { ChevronDown, History } from 'lucide-react'
import EmptyState from '../ui/EmptyState'
import RemoteState from '../ui/RemoteState'
import Pagination from '../ui/Pagination'
import { movementTypes, signedQuantity } from '../../utils/inventory'
const dateFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
export default function StockMovementHistory({ products, catalog }) {
  const [productFilter, setProductFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const { loadMovements, movementList } = catalog
  useEffect(() => { void loadMovements({ productId: productFilter === 'all' ? undefined : productFilter, type: typeFilter === 'all' ? undefined : typeFilter, page, limit: 20 }) }, [loadMovements, productFilter, typeFilter, page])
  const movements = movementList.data?.data ?? []
  const productById = new Map(products.map(product => [product.id, product]))
  return <details className="panel inventory-history" open>
    <summary><span className="flex items-center gap-3"><History size={20} className="text-slate-400" /><span><strong className="block text-sm font-semibold">Stock movement history</strong><span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">Stock changes and order movements · All times IST</span></span></span><ChevronDown className="history-chevron" size={18} /></summary>
    <div className="flex flex-col gap-3 px-6 pb-5 sm:flex-row">
      <div className="sm:w-64"><label htmlFor="movement-product" className="sr-only">Filter movements by product</label><select id="movement-product" className="catalog-control" value={productFilter} onChange={event => { setProductFilter(event.target.value); setPage(1) }}><option value="all">All products</option>{products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku}{!product.is_active ? ' (Archived)' : ''}</option>)}</select></div>
      <div className="sm:w-48"><label htmlFor="movement-type" className="sr-only">Filter movements by type</label><select id="movement-type" className="catalog-control" value={typeFilter} onChange={event => { setTypeFilter(event.target.value); setPage(1) }}><option value="all">All movement types</option>{movementTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    </div>
    <RemoteState resource={movementList} onRetry={() => loadMovements()}>
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Stock movement history table"><table className="inventory-history-table"><caption className="sr-only">Stock movements, newest first</caption><thead><tr>{['Date & Time (IST)', 'Product', 'Movement Type', 'Quantity Change', 'Previous Stock', 'New Stock', 'Reason'].map(label => <th scope="col" key={label} className={['Quantity Change', 'Previous Stock', 'New Stock'].includes(label) ? 'numeric-cell' : undefined}>{label}</th>)}</tr></thead><tbody>{movements.map(movement => <tr key={movement.id}>
        <td><time dateTime={movement.created_at}>{dateFormatter.format(new Date(movement.created_at))}</time></td><td><div className="product-name">{movement.product_name}</div><div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{movement.sku}{productById.get(movement.product_id)?.is_active === false ? ' · Archived' : ''}</div></td><td><span className="inventory-movement-type">{movementTypes.find(([type]) => type === movement.type)?.[1] ?? movement.type}</span>{movement.order_id && <span className="mt-2 block text-[10px] text-slate-500 dark:text-slate-400">{movement.order_id}</span>}</td><td className="numeric-cell"><strong className={movement.quantity_change < 0 ? 'inventory-negative' : 'inventory-positive'}>{signedQuantity(movement.quantity_change)}</strong></td><td className="numeric-cell">{movement.previous_stock}</td><td className="amount">{movement.new_stock}</td><td><div className="inventory-movement-reason">{movement.reason}</div></td>
      </tr>)}</tbody></table></div>
      {!movements.length && <EmptyState compact icon={History} title="No stock movements" description="No movements match this product and movement type." />}
      {movementList.data && <Pagination pagination={movementList.data.pagination} loading={movementList.loading} onPage={setPage} />}
    </RemoteState>
  </details>
}
