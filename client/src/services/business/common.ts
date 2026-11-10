import { ApiError } from '../api.ts'
export interface Resource<T> { data: T | null; loading: boolean; error: string | null }
export interface Envelope<T> { success: true; data: T }
export interface List<T> extends Envelope<T[]> { count: number }
export interface Paginated<T> extends List<T> { pagination: { page: number; limit: number; total: string } }
export function unwrap<T>(response: Envelope<T> | undefined): T {
  if (!response || response.success !== true || response.data === undefined || response.data === null) throw new ApiError('parse', 'The API returned an invalid response. Please retry.')
  return response.data
}
export function list<T>(response: List<T> | undefined): T[] {
  const rows = unwrap(response)
  if (!Array.isArray(rows)) throw new ApiError('parse', 'The API returned an invalid list. Please retry.')
  return rows
}
export function paginated<T>(response: Paginated<T> | undefined): Paginated<T> {
  list(response)
  if (!response?.pagination || !Number.isInteger(response.pagination.page) || response.pagination.page < 1 || response.pagination.page > 1000000 || !Number.isInteger(response.pagination.limit) || response.pagination.limit < 1 || response.pagination.limit > 100 || typeof response.pagination.total !== 'string' || !/^\d+$/.test(response.pagination.total)) throw new ApiError('parse', 'The API returned invalid pagination. Please retry.')
  return response
}
export const message = (error: unknown) => error instanceof ApiError ? error.message : 'The request could not be completed. Please retry.'
export const resource = <T>(): Resource<T> => ({ data: null, loading: true, error: null })
