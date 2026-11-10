import { api } from '../api.ts'
import type { QueryParams } from '../api.ts'
import { list, paginated, unwrap } from './common.ts'
import type { Envelope, List, Paginated } from './common.ts'
import type { BusinessClient, Product } from './products.ts'

export interface StockProduct extends Omit<Product, 'created_at'> { stock_status: 'in_stock' | 'low_stock' | 'out_of_stock' }
export interface Movement { id: string; product_id: string; product_name: string; sku: string; order_id: string | null; type: string; quantity_change: number; previous_stock: number; new_stock: number; reason: string; created_at: string }
export interface StockValues { quantity: string | number; reason?: string; note?: string }
export function inventoryQuery(search = '', status = 'all', sort = 'name-asc'): QueryParams {
  const [field, direction] = sort.split('-')
  return { search, status: status.replaceAll('-', '_'), sortBy: field === 'stock' ? 'stock_quantity' : field, sortOrder: direction }
}
export function stockPayload(values: StockValues, adjustment = false): Record<string, string | number> {
  const amount = Number(values.quantity)
  if (String(values.quantity).trim() === '' || !Number.isInteger(amount) || amount > 2147483647 || amount < (adjustment ? -2147483648 : 1) || amount === 0) throw new Error('Enter a valid nonzero stock change within the PostgreSQL integer range.')
  const reason = adjustment ? (values.reason === 'Other' ? `Other: ${values.note?.trim() ?? ''}` : values.reason?.trim()) : values.note?.trim() || 'Stock replenishment'
  if (!reason || reason.length < (adjustment ? 3 : 1) || reason.length > 500 || (adjustment && values.reason === 'Other' && !values.note?.trim())) throw new Error('Enter a meaningful stock-change reason (maximum 500 characters).')
  return adjustment ? { quantity_change: amount, reason } : { quantity: amount, reason }
}
export function createInventoryApi(client: BusinessClient = api) {
  const active = (rows: StockProduct[]) => rows.map(product => ({ ...product, is_active: true }))
  return {
    async list(query: QueryParams = inventoryQuery()) { return active(list(await client.get<List<StockProduct>>('/api/inventory', { query }))) },
    async alerts() { return active(list(await client.get<List<StockProduct>>('/api/inventory/alerts'))) },
    async movements(query: QueryParams = { page: 1, limit: 20 }) { return paginated(await client.get<Paginated<Movement>>('/api/inventory/movements', { query })) },
    async restock(id: string, values: StockValues) { return unwrap(await client.post<Envelope<{ product: Product; movement: Movement }>>(`/api/inventory/${encodeURIComponent(id)}/restock`, stockPayload(values))) },
    async adjust(id: string, values: StockValues) { return unwrap(await client.post<Envelope<{ product: Product; movement: Movement }>>(`/api/inventory/${encodeURIComponent(id)}/adjust`, stockPayload(values, true))) },
  }
}
