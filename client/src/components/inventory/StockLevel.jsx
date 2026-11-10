import StatusBadge from '../ui/StatusBadge'
import { getProductStatus } from '../../utils/products'
import { getStockHealth } from '../../utils/inventory'

const statuses = { 'in-stock': ['In Stock', 'green'], 'low-stock': ['Low Stock', 'amber'], 'out-of-stock': ['Out of Stock', 'red'] }

export function StockStatus({ product }) {
  const [label, tone] = statuses[getProductStatus(product)]
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

export default function StockLevel({ product }) {
  const health = getStockHealth(product)
  return <div className={`inventory-health ${getProductStatus(product)}`} role="progressbar" aria-label={`${product.name} stock health`}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(health.percentage)}
    aria-valuetext={`${product.stock_quantity} units; visual reference ${health.reference} units, not a stock capacity.`}
    title={`Reference: ${health.reference} units (not a capacity limit)`}><span style={{ width: `${health.percentage}%` }} /></div>
}
