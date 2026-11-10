import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTheme, getSystemDark, readTheme, resolveTheme, saveTheme, subscribeToSystemTheme, THEME_KEY } from '../theme.js'
import { DEFAULT_WORKSPACE_NAME, readWorkspaceName, saveWorkspaceName, validateWorkspaceName, WORKSPACE_NAME_KEY } from '../services/workspacePreferences.js'

function browser(t) {
  const original = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage }
  const data = new Map()
  const listeners = new Set()
  const media = { matches: false, addEventListener: (_name, callback) => listeners.add(callback), removeEventListener: (_name, callback) => listeners.delete(callback) }
  const meta = { content: '', setAttribute: (_name, value) => { meta.content = value } }
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  globalThis.window = { matchMedia: () => media }
  globalThis.document = { documentElement: { dataset: {} }, querySelector: () => meta }
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  })
  return { data, media, meta, listeners }
}

test('saved Light and Dark preferences remain compatible and restore after reload', t => {
  const { data, meta } = browser(t)
  assert.equal(readTheme(), 'light')
  for (const preference of ['dark', 'light']) {
    assert.equal(saveTheme(preference), true)
    assert.equal(data.get(THEME_KEY), preference)
    document.documentElement.dataset = {}
    applyTheme(readTheme())
    assert.equal(document.documentElement.dataset.theme, preference)
    assert.equal(meta.content, preference === 'dark' ? '#0f172a' : '#f8fafc')
  }
})

test('System stores the preference and resolves from the current OS on reload', t => {
  const { data, media } = browser(t)
  media.matches = true
  assert.equal(saveTheme('system'), true)
  assert.equal(data.get(THEME_KEY), 'system')
  assert.equal(document.documentElement.dataset.theme, 'dark')
  media.matches = false
  applyTheme(readTheme())
  assert.equal(readTheme(), 'system')
  assert.equal(document.documentElement.dataset.theme, 'light')
})

test('OS preference changes are observable and explicit choices stay independent', t => {
  const { media, listeners } = browser(t)
  const observed = []
  const unsubscribe = subscribeToSystemTheme(() => observed.push(resolveTheme('system', getSystemDark())))
  media.matches = true
  for (const listener of listeners) listener()
  media.matches = false
  for (const listener of listeners) listener()
  assert.deepEqual(observed, ['dark', 'light'])
  assert.equal(resolveTheme('dark', false), 'dark')
  assert.equal(resolveTheme('light', true), 'light')
  unsubscribe()
  assert.equal(listeners.size, 0)
})

test('invalid/blocked theme storage is safe and an unsaved selection still applies', t => {
  const { data } = browser(t)
  data.set(THEME_KEY, 'invalid')
  assert.equal(readTheme(), 'light')
  assert.equal(saveTheme('invalid'), false)
  globalThis.localStorage = { getItem() { throw Error('blocked') }, setItem() { throw Error('full') } }
  assert.equal(readTheme(), 'light')
  assert.equal(saveTheme('dark'), false)
  assert.equal(document.documentElement.dataset.theme, 'dark')
})

test('workspace names validate, trim, persist and reload without touching business data', t => {
  const { data } = browser(t)
  const businessSnapshot = '{"products":[1],"orders":[2],"movements":[3]}'
  data.set('inventra-inventory-v1', businessSnapshot)
  assert.equal(readWorkspaceName(), DEFAULT_WORKSPACE_NAME)
  assert.equal(saveWorkspaceName('  North Warehouse  '), 'North Warehouse')
  assert.equal(data.get(WORKSPACE_NAME_KEY), 'North Warehouse')
  assert.equal(readWorkspaceName(), 'North Warehouse')
  assert.equal(data.get('inventra-inventory-v1'), businessSnapshot)
  assert.equal(validateWorkspaceName('a'.repeat(60)), null)
  assert.equal(saveWorkspaceName('a'.repeat(60)), 'a'.repeat(60))
  for (const name of ['', '   ', 'a'.repeat(61)]) {
    assert.ok(validateWorkspaceName(name))
    assert.throws(() => saveWorkspaceName(name))
  }
  assert.equal(readWorkspaceName(), 'a'.repeat(60))
})

test('corrupt or unavailable workspace storage falls back safely and reports save failures', t => {
  const { data } = browser(t)
  data.set(WORKSPACE_NAME_KEY, ' '.repeat(10))
  assert.equal(readWorkspaceName(), DEFAULT_WORKSPACE_NAME)
  data.set(WORKSPACE_NAME_KEY, 'a'.repeat(61))
  assert.equal(readWorkspaceName(), DEFAULT_WORKSPACE_NAME)
  globalThis.localStorage = { getItem() { throw Error('blocked') }, setItem() { throw Error('full') } }
  assert.equal(readWorkspaceName(), DEFAULT_WORKSPACE_NAME)
  assert.throws(() => saveWorkspaceName('Main Office'), /Could not save/)
})
