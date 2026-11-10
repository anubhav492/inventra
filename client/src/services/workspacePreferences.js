export const WORKSPACE_NAME_KEY = 'inventra-workspace-name'
export const DEFAULT_WORKSPACE_NAME = 'My Workspace'

export function validateWorkspaceName(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Enter a workspace name.'
  if (value.trim().length > 60) return 'Workspace name must be 60 characters or fewer.'
  return null
}

export function readWorkspaceName(storage) {
  try {
    const name = (storage ?? globalThis.localStorage)?.getItem(WORKSPACE_NAME_KEY)
    if (!validateWorkspaceName(name)) return name.trim()
  } catch {
    // Browser storage is optional; preferences can still use their defaults.
  }
  return DEFAULT_WORKSPACE_NAME
}

export function saveWorkspaceName(value, storage) {
  const validationError = validateWorkspaceName(value)
  if (validationError) throw new Error(validationError)
  const name = value.trim()
  try {
    const target = storage ?? globalThis.localStorage
    if (!target) throw new Error('Storage unavailable')
    target.setItem(WORKSPACE_NAME_KEY, name)
  } catch {
    throw new Error('Could not save your workspace name. Browser storage may be unavailable or full. Please try again.')
  }
  return name
}
