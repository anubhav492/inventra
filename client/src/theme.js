export const THEME_KEY = 'inventra-theme'
export const themePreferences = ['light', 'dark', 'system']

export function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (themePreferences.includes(saved)) return saved
  } catch {
    // Keep the theme usable when browser storage is unavailable.
  }
  return 'light'
}

export function getSystemDark() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
}

export function resolveTheme(preference, systemDark = getSystemDark()) {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference === 'dark' ? 'dark' : 'light'
}

export function subscribeToSystemTheme(onChange) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function applyTheme(preference) {
  const theme = resolveTheme(preference)
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content', theme === 'dark' ? '#0f172a' : '#f8fafc',
  )
}

export function saveTheme(theme) {
  if (!themePreferences.includes(theme)) return false
  applyTheme(theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
    return true
  } catch {
    // The selection still works for this visit if storage is blocked.
    return false
  }
}
