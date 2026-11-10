import { ApiError } from '../api.ts'
import type { QueryParams } from '../api.ts'
import { createProductsApi, productQuery } from './products.ts'
import type { BusinessClient, Product, ProductValues } from './products.ts'
import { message, resource } from './common.ts'
import type { Resource } from './common.ts'
import type { Paginated } from './common.ts'
import { createInventoryApi, inventoryQuery } from './inventory.ts'
import type { StockProduct, Movement, StockValues } from './inventory.ts'
import { createOrdersApi, orderQuery } from './orders.ts'
import type { Order, OrderSummary, OrderRequest, Summary } from './orders.ts'
import { createDashboardApi } from './dashboard.ts'
import type { RecentOrder, RevenueDay } from './dashboard.ts'
interface Data { catalog: Product[]; productList: Product[]; productDetail: Product; inventoryList: StockProduct[]; alerts: StockProduct[]; movementList: Paginated<Movement>; orderList: Paginated<OrderSummary>; orderDetail: Order; summary: Summary; recentOrders: RecentOrder[]; dashboardLowStock: StockProduct[]; revenue: RevenueDay[] }
type Key = keyof Data
type State = { [K in Key]: Resource<Data[K]> } & { pending: boolean; warning: string | null }
export function createBusinessStore({ client, onUnauthorized = () => {} }: { client?: BusinessClient; onUnauthorized?: () => void } = {}) {
  const productsApi = createProductsApi(client)
  const inventoryApi = createInventoryApi(client)
  const ordersApi = createOrdersApi(client)
  const dashboardApi = createDashboardApi(client)
  const initial = (): State => ({ catalog: resource(), productList: resource(), productDetail: resource(), inventoryList: resource(), alerts: resource(), movementList: resource(), orderList: resource(), orderDetail: resource(), summary: resource(), recentOrders: resource(), dashboardLowStock: resource(), revenue: resource(), pending: false, warning: null })
  let state = initial(), active = true
  let queries: QueryParams = productQuery()
  let stockQuery: QueryParams = inventoryQuery(), movementQuery: QueryParams = { page: 1, limit: 20 }
  let ordersQuery: QueryParams = orderQuery(), detailId: string | undefined
  let productId: string | undefined
  const requested = new Set<Key>()
  const versions: Record<Key, number> = { catalog: 0, productList: 0, productDetail: 0, inventoryList: 0, alerts: 0, movementList: 0, orderList: 0, orderDetail: 0, summary: 0, recentOrders: 0, dashboardLowStock: 0, revenue: 0 }
  const listeners = new Set<() => void>()
  const emit = (next: State) => { state = next; listeners.forEach(listener => listener()) }
  function deactivate() { active = false; for (const key of Object.keys(versions) as Key[]) versions[key]++ }
  async function load<K extends Key>(key: K, work: () => Promise<Data[K]>) {
    const version = ++versions[key]
    requested.add(key)
    emit({ ...state, [key]: { ...state[key], loading: true, error: null } })
    try {
      const data = await work()
      if (active && version === versions[key]) { emit({ ...state, [key]: { data, loading: false, error: null } }); return data }
    } catch (error) {
      if (!active || version !== versions[key]) return
      if (error instanceof ApiError && error.status === 401) { deactivate(); emit(initial()); onUnauthorized(); return }
      emit({ ...state, [key]: { data: null, loading: false, error: message(error) } })
    }
  }
  const loadCatalog = () => load('catalog', () => productsApi.list({ status: 'all' }))
  const loadProduct = (id: string = productId ?? '') => {
    if (productId !== id) emit({ ...state, productDetail: resource() })
    productId = id
    return load('productDetail', () => productsApi.get(id))
  }
  const loadProducts = (query: QueryParams = queries) => { queries = query; return load('productList', () => productsApi.list(query)) }
  const loadInventory = (query: QueryParams = stockQuery) => { stockQuery = query; return load('inventoryList', () => inventoryApi.list(query)) }
  const loadAlerts = () => load('alerts', () => inventoryApi.alerts())
  const loadMovements = (query: QueryParams = movementQuery) => { movementQuery = query; return load('movementList', () => inventoryApi.movements(query)) }
  const loadOrders = async (query: QueryParams = ordersQuery): Promise<Paginated<OrderSummary> | undefined> => {
    ordersQuery = query
    const result = await load('orderList', () => ordersApi.list(query))
    if (result && ordersQuery === query && !result.data.length && result.pagination.page > 1) {
      const last = Number((BigInt(result.pagination.total || '0') + BigInt(result.pagination.limit) - 1n) / BigInt(result.pagination.limit)) || 1
      if (last < result.pagination.page) return loadOrders({ ...query, page: last })
    }
    return result
  }
  const loadSummary = () => load('summary', () => dashboardApi.summary())
  const loadRecentOrders = () => load('recentOrders', () => dashboardApi.recent())
  const loadDashboardLowStock = () => load('dashboardLowStock', () => dashboardApi.lowStock())
  const loadRevenue = () => load('revenue', () => dashboardApi.revenue())
  const loadDashboard = () => Promise.all([loadSummary(), loadRecentOrders(), loadDashboardLowStock(), loadRevenue()])
  const loadOrder = (id: string = detailId ?? '') => {
    if (detailId !== id) emit({ ...state, orderDetail: resource() })
    detailId = id
    return load('orderDetail', () => ordersApi.get(id))
  }
  const refresh = async () => {
    const jobs: Partial<Record<Key, () => Promise<unknown>>> = { productDetail: loadProduct, inventoryList: loadInventory, alerts: loadAlerts, movementList: loadMovements, orderList: loadOrders, summary: loadSummary, orderDetail: loadOrder, recentOrders: loadRecentOrders, dashboardLowStock: loadDashboardLowStock, revenue: loadRevenue }
    await Promise.all([loadCatalog(), loadProducts(), ...Object.entries(jobs).filter(([key]) => requested.has(key as Key)).map(([, job]) => job!())])
  }
  async function mutate<T>(work: () => Promise<T>): Promise<T> {
    if (state.pending) throw new Error('Another change is in progress. Please wait.')
    emit({ ...state, pending: true, warning: null })
    try {
      const result = await work()
      if (active) {
        await refresh()
        if (Object.values(state).some(value => value && typeof value === 'object' && 'error' in value && value.error)) emit({ ...state, warning: 'Your change was saved, but some views could not refresh. Retry the failed view; do not repeat the change.' })
      }
      return result
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { deactivate(); emit(initial()); onUnauthorized() }
      else if (active && error instanceof ApiError) {
        if (error.kind === 'network' || (error.status ?? 0) >= 500) emit({ ...state, warning: 'The change could not be confirmed. Refresh the affected view before repeating the action.' })
        if ([404, 409].includes(error.status ?? 0) || error.kind === 'network') await refresh()
      }
      throw error
    } finally { if (active) emit({ ...state, pending: false }) }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    start() { active = true; return refresh() },
    dispose() { deactivate(); state = initial() },
    loadCatalog, loadProducts, loadProduct, loadInventory, loadAlerts, loadMovements, loadOrders, loadOrder, loadSummary, loadRecentOrders, loadDashboardLowStock, loadRevenue, loadDashboard, refresh,
    addProduct: (values: ProductValues) => mutate(() => productsApi.create(values)),
    updateProduct: (id: string, values: ProductValues) => mutate(() => productsApi.update(id, values)),
    archiveProduct: (id: string) => mutate(() => productsApi.archive(id)),
    restoreProduct: (id: string) => mutate(() => productsApi.restore(id)),
    restockProduct: (id: string, values: StockValues) => mutate(() => inventoryApi.restock(id, values)),
    adjustStock: (id: string, values: StockValues) => mutate(() => inventoryApi.adjust(id, values)),
    placeOrder: (items: OrderRequest[]) => mutate(() => ordersApi.create(items)),
    completeOrder: (id: string) => mutate(() => ordersApi.complete(id)),
    cancelOrder: (id: string) => mutate(() => ordersApi.cancel(id)),
  }
}
