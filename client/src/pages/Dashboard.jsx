import { useEffect } from 'react'
import { Package, Warehouse, ShoppingCart, IndianRupee, AlertTriangle, ArrowRight, Activity } from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import EmptyState from '../components/ui/EmptyState'
import OrderStatus from '../components/orders/OrderStatus'
import { formatCurrency } from '../utils/currency'
import { getStockHealth } from '../utils/inventory'
import { formatOrderDate } from '../utils/orders'
import { revenueChart, revenueTotal } from '../services/business/dashboard'
import RemoteState from '../components/ui/RemoteState'

export default function Dashboard({ catalog, onViewOrder }) {
  const { loadDashboard } = catalog
  useEffect(() => { void loadDashboard() }, [loadDashboard])
  const summary = catalog.summary.data
  const alerts = catalog.dashboardLowStock.data ?? []
  const recentOrders = catalog.recentOrders.data ?? []
  const weeklyRevenue = revenueChart(catalog.revenue.data ?? [])
  const weekTotal = revenueTotal(catalog.revenue.data ?? [])
  const chartMaximum = Math.max(100, Math.ceil(Math.max(0, ...weeklyRevenue.map(day => day.total)) / 100) * 100)
  const axisTicks = [1, .75, .5, .25, 0].map(fraction => chartMaximum * fraction)
  const totalProducts = summary?.total_active_products

  return <>
    <div className="overview-heading"><div><span className="eyebrow">YOUR WORKSPACE AT A GLANCE</span><h2>Business overview</h2><p>Here’s what’s happening with your inventory today.</p></div><span className="demo-label"><span />Saved to your account</span></div>
    <RemoteState resource={catalog.summary} onRetry={() => catalog.loadSummary()}><section className="stats-grid" aria-label="Business statistics">
      <StatCard label="Total Products" value={totalProducts} helperText="Non-archived catalog products" icon={Package} tone="indigo" />
      <StatCard label="Inventory Value (Selling Price)" value={formatCurrency(summary?.total_inventory_value)} helperText={`${summary ? BigInt(summary.total_stock_units).toLocaleString('en-IN') : ''} units in active stock`} icon={Warehouse} tone="blue" />
      <StatCard label="Total Orders" value={summary?.total_orders} helperText="Including cancelled orders" icon={ShoppingCart} tone="violet" />
      <StatCard label="Revenue" value={formatCurrency(summary?.total_revenue)} helperText="Completed orders only · All time" icon={IndianRupee} tone="green" />
    </section></RemoteState>
    <div className="dashboard-grid">
      <RemoteState resource={catalog.revenue} onRetry={() => catalog.loadRevenue()}><section className="panel revenue-panel">
        <div className="panel-heading"><div><h2>Revenue overview</h2><p>Realized revenue by completion date · IST</p></div><span className="period-label">Last 7 days</span></div>
        <div className="revenue-summary"><strong>{formatCurrency(weekTotal)}</strong><span className="muted text-xs">Completed in the last 7 days</span></div>
        <div className="bar-chart" role="img" aria-label={`Completed-order revenue in INR: ${weeklyRevenue.map(day => `${day.date} ${formatCurrency(day.revenue)}`).join(', ')}`}>
          <div className="chart-labels">{axisTicks.map((amount, index) => <span key={index}>{formatCurrency(amount)}</span>)}</div>
          <div className="chart-bars">{weeklyRevenue.map(day => <div className="bar-column" key={day.date} title={`${day.date}: ${formatCurrency(day.revenue)}`}><div className="bar-track"><div className={`bar ${day.total > 0 && day.total === Math.max(...weeklyRevenue.map(item => item.total)) ? 'highlight' : ''}`} style={{ height: `${day.total / chartMaximum * 100}%`, minHeight: day.total ? undefined : 0 }} /></div><span>{day.label}</span></div>)}</div>
        </div>
        <div className="chart-legend" aria-label="Revenue chart legend"><span><i aria-hidden="true" />Completed-order revenue</span>{Number(weekTotal) > 0 && <span><i className="peak" aria-hidden="true" />Highest day</span>}</div>
        {Number(weekTotal) === 0 && <p className="revenue-empty">No completed-order revenue in this period. Placed and cancelled orders do not count as realized revenue.</p>}
      </section></RemoteState>
      <RemoteState resource={catalog.dashboardLowStock} onRetry={() => catalog.loadDashboardLowStock()}><section className="panel low-stock-panel">
        <div className="panel-heading"><div className="heading-with-icon"><AlertTriangle className="warning-icon" size={18} /><h2>Low stock alerts</h2></div><span className="count-badge">{alerts.length} shown</span></div>
        <p className="stock-intro">{alerts.length ? 'These products need your attention.' : 'No low-stock products to display.'}</p>
        <div className="stock-list">{alerts.slice(0, 3).map(product => <div className="stock-item" key={product.id}><span className="product-thumbnail"><Package size={18} /></span><div className="stock-details"><strong>{product.name}</strong><span>{product.sku}</span><div className="stock-track"><span style={{ width: `${getStockHealth(product).percentage}%` }} /></div></div><span className={`stock-quantity ${product.stock_quantity === 0 ? 'inventory-negative' : ''}`}>{product.stock_quantity === 0 ? 'Out of stock' : `${product.stock_quantity} left`}</span></div>)}</div>
        <a href="#inventory" className="stock-link">View inventory<ArrowRight size={16} /></a>
      </section></RemoteState>
    </div>
    <RemoteState resource={catalog.recentOrders} onRetry={() => catalog.loadRecentOrders()}><section className="panel orders-panel">
      <div className="panel-heading"><div><h2>Recent orders</h2><p>Your five most recent customer orders</p></div><a href="#orders" className="text-link">View all orders<ArrowRight size={15} /></a></div>
      <div className="table-scroll"><table><thead><tr><th scope="col">Order ID</th><th scope="col">Date (IST)</th><th scope="col" className="numeric-cell">Amount</th><th scope="col">Status</th></tr></thead><tbody>{recentOrders.map(order => <tr key={order.id}><td><button className="order-reference-button" aria-label={`View ${order.id}`} onClick={() => onViewOrder(order.id)}>{order.id}</button></td><td className="muted"><time dateTime={order.created_at}>{formatOrderDate(order.created_at)}</time></td><td className="amount">{formatCurrency(order.total_amount)}</td><td><OrderStatus status={order.status} /></td></tr>)}</tbody></table></div>
      {!recentOrders.length && <EmptyState compact icon={ShoppingCart} title="No orders yet" description="Create your first order to start tracking fulfillment." action={<a className="text-link" href="#orders">Go to Orders<ArrowRight size={15} /></a>} />}
      <div className="table-footer"><Activity size={14} /> Showing {recentOrders.length} recent orders</div>
    </section></RemoteState>
    <footer className="page-footer">Inventra <span>·</span> Everything in order.</footer>
  </>
}
