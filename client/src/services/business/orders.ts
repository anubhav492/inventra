import { api, ApiError } from '../api.ts'
import type { QueryParams } from '../api.ts'
import { paginated, unwrap } from './common.ts'
import type { Envelope, Paginated } from './common.ts'
import type { BusinessClient } from './products.ts'
export interface OrderSummary { id: string; status: 'placed' | 'completed' | 'cancelled'; total_amount: string; created_at: string; completed_at: string | null; cancelled_at: string | null; item_count: number }
export interface OrderItem { id: string; product_id: string; product_name: string; sku: string; quantity: number; unit_price: string; line_total: string }
export interface Order extends Omit<OrderSummary, 'item_count'> { items: OrderItem[] }
export interface OrderRequest { product_id: string; quantity: string | number }
export interface Summary { total_active_products: number; total_stock_units: string; total_inventory_value: string; low_stock_count: number; out_of_stock_count: number; total_orders: number; placed_orders: number; completed_orders: number; cancelled_orders: number; total_revenue: string }
export function orderQuery(search = '', status = 'all', sort = 'newest', page = 1): QueryParams {
  return { search, status, page, limit: 20, sortBy: sort.startsWith('amount-') ? 'total_amount' : 'created_at', sortOrder: sort === 'oldest' || sort === 'amount-asc' ? 'asc' : 'desc' }
}
export function orderPayload(items: OrderRequest[]) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('Select between 1 and 100 products.')
  const seen = new Set<string>()
  return { items: items.map(item => {
    if (typeof item.product_id !== 'string' || !item.product_id || seen.has(item.product_id.toLowerCase())) throw new Error('Each product must appear only once.')
    seen.add(item.product_id.toLowerCase())
    if (String(item.quantity).trim() === '' || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 2147483647) throw new Error('Order quantities must be positive PostgreSQL integers.')
    return { product_id: item.product_id, quantity: Number(item.quantity) }
  }) }
}
export function createOrdersApi(client: BusinessClient = api) {
  async function detail(response: Envelope<Order> | undefined) {
    const order = unwrap(response)
    if (!Array.isArray(order.items)) throw new ApiError('parse', 'The API returned invalid order details. Please retry.')
    return order
  }
  return {
    async list(query: QueryParams = orderQuery()) { return paginated(await client.get<Paginated<OrderSummary>>('/api/orders', { query })) },
    async get(id: string) { return detail(await client.get<Envelope<Order>>(`/api/orders/${encodeURIComponent(id)}`)) },
    async create(items: OrderRequest[]) { return detail(await client.post<Envelope<Order>>('/api/orders', orderPayload(items))) },
    async complete(id: string) { return detail(await client.patch<Envelope<Order>>(`/api/orders/${encodeURIComponent(id)}/complete`, {})) },
    async cancel(id: string) { return detail(await client.patch<Envelope<Order>>(`/api/orders/${encodeURIComponent(id)}/cancel`, {})) },
  }
}
