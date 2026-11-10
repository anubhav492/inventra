export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type ApiErrorKind = 'http' | 'network' | 'parse' | 'request'
export type QueryParams = Record<string, string | number | boolean | null | undefined>

export interface ApiRequestOptions {
  headers?: HeadersInit
  signal?: AbortSignal
  query?: QueryParams
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly data: unknown

  constructor(kind: ApiErrorKind, message: string, status: number | null = null, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.data = data
  }
}

export const API_BASE_URL = import.meta.env?.VITE_API_URL ?? 'http://localhost:5000'

/** Response types describe the expected contract; they do not validate JSON at runtime. */
export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = globalThis.fetch) {
  let base: URL
  try {
    base = new URL(baseUrl)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error()
    base.pathname = base.pathname.replace(/\/$/, '') + '/'
  } catch {
    throw new ApiError('request', 'API base URL must be an absolute HTTP(S) URL without credentials, query or fragment')
  }

  async function request<T>(method: string, path: string, body: JsonValue | undefined, options: ApiRequestOptions = {}): Promise<T | undefined> {
    let url: URL
    let headers: Headers
    let serialized: string | undefined
    try {
      // Keep credentialed requests on the configured API origin and base path.
      if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//') || path.includes('\\') || path.includes('#')) throw new Error()
      url = new URL(path.replace(/^\//, ''), base)
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error()
      for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value !== null && value !== undefined) url.searchParams.set(key, String(value))
      }
      headers = new Headers(options.headers)
      headers.set('Accept', 'application/json')
      if (body !== undefined) {
        serialized = JSON.stringify(body)
        if (serialized === undefined) throw new Error()
        headers.set('Content-Type', 'application/json')
      }
    } catch {
      throw new ApiError('request', 'Invalid API path, headers or JSON request body')
    }

    let response: Response
    let text: string
    try {
      response = await fetchImpl(url.href, {
        method, credentials: 'include', headers, signal: options.signal,
        ...(serialized === undefined ? {} : { body: serialized }),
      })
      if (response.status === 204) return undefined
      text = await response.text()
    } catch {
      // Includes fetch/CORS failures, body-read failures and aborted requests.
      throw new ApiError('network', options.signal?.aborted ? 'API request was cancelled' : 'Unable to reach the API')
    }

    let data: unknown
    let parseFailed = false
    if (text.trim()) {
      try { data = JSON.parse(text) as unknown } catch { parseFailed = true }
    }
    if (!response.ok) {
      const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' && data.message.trim()
        ? data.message : `API request failed (${response.status})`
      throw new ApiError('http', message, response.status, data)
    }
    if (parseFailed) throw new ApiError('parse', 'API returned invalid JSON', response.status)
    return data as T | undefined
  }

  return {
    get: <T = unknown>(path: string, options?: ApiRequestOptions) => request<T>('GET', path, undefined, options),
    post: <T = unknown>(path: string, body?: JsonValue, options?: ApiRequestOptions) => request<T>('POST', path, body, options),
    patch: <T = unknown>(path: string, body?: JsonValue, options?: ApiRequestOptions) => request<T>('PATCH', path, body, options),
    put: <T = unknown>(path: string, body?: JsonValue, options?: ApiRequestOptions) => request<T>('PUT', path, body, options),
    delete: <T = unknown>(path: string, body?: JsonValue, options?: ApiRequestOptions) => request<T>('DELETE', path, body, options),
  }
}

export const api = createApiClient(API_BASE_URL)
