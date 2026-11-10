import { api } from '../api.ts'
import type { QueryParams } from '../api.ts'
import { list, unwrap } from './common.ts'
import type { Envelope, List } from './common.ts'
export interface Product { id: string; name: string; sku: string; price: string; stock_quantity: number; low_stock_threshold: number; is_active: boolean; created_at: string }
export interface ProductValues { name: string; sku: string; price: string; stock_quantity?: string | number; low_stock_threshold: string | number }
export type BusinessClient = Pick<typeof api, 'get' | 'post' | 'patch'>
export function productQuery(search = '', status = 'all', sort = 'name-asc'): QueryParams {
  const [field, direction] = sort.split('-')
  return { search, status: status === 'all' ? 'active' : status.replaceAll('-', '_'), sortBy: field === 'stock' ? 'stock_quantity' : field, sortOrder: direction }
}
export function validateProductInput(values: ProductValues, editing = false) {
  const errors: Record<string, string> = {}
  if (!values.name.trim() || values.name.trim().length > 150) errors.name = 'Enter a product name of 1–150 characters.'
  if (!values.sku.trim() || values.sku.trim().length > 50) errors.sku = 'Enter a SKU of 1–50 characters.'
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(values.price).trim()) || Number(values.price) > 9999999999.99) errors.price = 'Use a nonnegative INR price with at most two decimal places (maximum 9999999999.99).'
  for (const key of editing ? ['low_stock_threshold'] as const : ['stock_quantity', 'low_stock_threshold'] as const) {
    if (String(values[key] ?? '').trim() === '' || !Number.isInteger(Number(values[key])) || Number(values[key]) < 0 || Number(values[key]) > 2147483647) errors[key] = 'Enter a whole number from 0 to 2147483647.'
  }
  return errors
}
export function productPayload(values: ProductValues, editing = false) {
  const errors = validateProductInput(values, editing)
  if (Object.keys(errors).length) throw Object.assign(new Error('Please check the highlighted fields.'), { fields: errors })
  return { name: values.name.trim(), sku: values.sku.trim(), price: String(values.price).trim(), low_stock_threshold: Number(values.low_stock_threshold), ...(editing ? {} : { stock_quantity: Number(values.stock_quantity) }) }
}
export function createProductsApi(client: BusinessClient = api) {
  return {
    async list(query: QueryParams = { status: 'all' }) { return list(await client.get<List<Product>>('/api/products', { query })) },
    async get(id: string) { return unwrap(await client.get<Envelope<Product>>(`/api/products/${encodeURIComponent(id)}`)) },
    async create(values: ProductValues) { return unwrap(await client.post<Envelope<Product>>('/api/products', productPayload(values))) },
    async update(id: string, values: ProductValues) { return unwrap(await client.patch<Envelope<Product>>(`/api/products/${encodeURIComponent(id)}`, productPayload(values, true))) },
    async archive(id: string) { return unwrap(await client.patch<Envelope<Product>>(`/api/products/${encodeURIComponent(id)}/archive`, {})) },
    async restore(id: string) { return unwrap(await client.patch<Envelope<Product>>(`/api/products/${encodeURIComponent(id)}/restore`, {})) },
  }
}
