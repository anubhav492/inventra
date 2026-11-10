import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { applyTheme, getSystemDark, readTheme, resolveTheme, saveTheme, subscribeToSystemTheme, themePreferences } from '../theme'

export default function useTheme() {
  const [preference, setPreference] = useState(readTheme)
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, getSystemDark, () => false)
  const resolvedTheme = resolveTheme(preference, systemDark)

  useLayoutEffect(() => { applyTheme(resolvedTheme) }, [resolvedTheme])

  function selectTheme(next) {
    if (!themePreferences.includes(next)) return false
    const saved = saveTheme(next)
    setPreference(next)
    return saved
  }

  function toggleTheme() {
    // The two-state Header toggle selects an explicit preference, including from System.
    return selectTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return { preference, resolvedTheme, selectTheme, toggleTheme }
}
