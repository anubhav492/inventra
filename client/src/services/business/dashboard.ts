import { api, ApiError } from '../api.ts'
import { list, unwrap } from './common.ts'
import type { Envelope, List } from './common.ts'
import type { BusinessClient } from './products.ts'
import type { StockProduct } from './inventory.ts'
import type { OrderSummary, Summary } from './orders.ts'
export interface RevenueDay { date: string; revenue: string }
export type RecentOrder = Pick<OrderSummary, 'id' | 'status' | 'total_amount' | 'created_at' | 'item_count'>
export function revenueChart(rows: RevenueDay[]) {
  const formatter = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })
  return rows.map(day => ({ ...day, total: Number(day.revenue), label: formatter.format(new Date(`${day.date}T00:00:00Z`)) }))
}
export function revenueTotal(rows: RevenueDay[]): string {
  const cents = rows.reduce((sum, day) => {
    const [whole, fraction = ''] = day.revenue.split('.')
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  }, 0n)
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}
export function createDashboardApi(client: BusinessClient = api) {
  return {
    async summary() { return unwrap(await client.get<Envelope<Summary>>('/api/dashboard/summary')) },
    async recent() { return list(await client.get<List<RecentOrder>>('/api/dashboard/recent-orders', { query: { limit: 5 } })) },
    async lowStock() { return list(await client.get<List<StockProduct>>('/api/dashboard/low-stock', { query: { limit: 3 } })) },
    async revenue(period: '7d' | '30d' | '90d' = '7d') {
      const rows = unwrap(await client.get<Envelope<RevenueDay[]>>('/api/dashboard/revenue', { query: { period } }))
      if (!Array.isArray(rows) || rows.some(row => {
        const date = new Date(`${row.date}T00:00:00Z`)
        return !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.date || typeof row.revenue !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(row.revenue)
      })) throw new ApiError('parse', 'The API returned invalid revenue data. Please retry.')
      return rows
    },
  }
}
