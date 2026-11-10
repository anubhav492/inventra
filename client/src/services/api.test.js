import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, createApiClient } from './api.ts'

test('all five verbs use the centralized URL, JSON headers and included credentials', async () => {
  const calls = []
  const client = createApiClient('http://localhost:5000/', async (url, options) => {
    calls.push({ url, ...options })
    return Response.json({ success: true })
  })
  assert.deepEqual(await client.get('/api/example', { query: { search: 'a & b', page: 0, active: false, absent: undefined } }), { success: true })
  for (const method of ['post', 'patch', 'put', 'delete']) {
    await client[method]('/api/example', { name: 'Example' }, { headers: { 'X-Request-Id': 'test', 'Content-Type': 'text/plain' } })
  }
  assert.equal(calls[0].url, 'http://localhost:5000/api/example?search=a+%26+b&page=0&active=false')
  assert.equal(calls[0].body, undefined)
  assert.equal(calls[0].headers.has('Content-Type'), false)
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
  for (const call of calls) {
    assert.equal(call.credentials, 'include')
    assert.equal(call.headers.get('Accept'), 'application/json')
  }
  for (const call of calls.slice(1)) {
    assert.equal(call.headers.get('Content-Type'), 'application/json')
    assert.equal(call.headers.get('X-Request-Id'), 'test')
    assert.deepEqual(JSON.parse(call.body), { name: 'Example' })
  }
})

test('204 and empty responses return undefined, while JSON null is preserved', async () => {
  for (const response of [new Response(null, { status: 204 }), new Response('', { status: 200 })]) {
    assert.equal(await createApiClient('http://localhost:5000', async () => response).delete('/api/example'), undefined)
  }
  assert.equal(await createApiClient('http://localhost:5000', async () => Response.json(null)).get('/api/example'), null)
})

test('HTTP failures preserve status and parsed JSON; non-JSON failures use a safe fallback', async () => {
  for (const status of [400, 401, 403, 404, 409, 429, 500]) {
    const data = { success: false, message: 'Request rejected' }
    const client = createApiClient('http://localhost:5000', async () => Response.json(data, { status }))
    await assert.rejects(client.get('/api/example'), error => error instanceof ApiError && error.kind === 'http' && error.status === status && error.message === data.message && error.data.message === data.message)
  }
  const client = createApiClient('http://localhost:5000', async () => new Response('<html>proxy error</html>', { status: 502 }))
  await assert.rejects(client.get('/api/example'), error => error.kind === 'http' && error.status === 502 && error.data === undefined && error.message === 'API request failed (502)')
})

test('malformed success JSON, network failures, aborts and body-read failures use ApiError', async () => {
  const malformed = createApiClient('http://localhost:5000', async () => new Response('{invalid'))
  await assert.rejects(malformed.get('/api/example'), error => error.kind === 'parse' && error.status === 200)
  const controller = new AbortController()
  const network = createApiClient('http://localhost:5000', async (_url, options) => {
    assert.equal(options.signal, controller.signal)
    throw Error('Raw network details')
  })
  await assert.rejects(network.get('/api/example', { signal: controller.signal }), error => error.kind === 'network' && error.status === null && error.message === 'Unable to reach the API')
  controller.abort()
  await assert.rejects(network.get('/api/example', { signal: controller.signal }), error => error.kind === 'network' && error.message === 'API request was cancelled')
  const readFailure = createApiClient('http://localhost:5000', async () => ({ status: 200, text: async () => { throw Error('read failed') } }))
  await assert.rejects(readFailure.get('/api/example'), error => error instanceof ApiError && error.kind === 'network')
})

test('external destinations and invalid configuration/serialization fail before fetch', async () => {
  for (const url of ['bad', 'file:///tmp/api', 'https://user:password@example.com', 'https://example.com?token=secret']) {
    assert.throws(() => createApiClient(url), error => error instanceof ApiError && error.kind === 'request')
  }
  let calls = 0
  const client = createApiClient('http://localhost:5000/backend/', async () => { calls++; return Response.json({}) })
  for (const path of ['https://evil.example/api', '//evil.example/api', '\\evil.example', '../escape', '/api/example#fragment']) {
    await assert.rejects(client.get(path), error => error.kind === 'request')
  }
  const circular = {}; circular.self = circular
  await assert.rejects(client.post('/api/example', circular), error => error.kind === 'request')
  assert.equal(calls, 0)
  await client.get('/api/example')
  assert.equal(calls, 1)
})
