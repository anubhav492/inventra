import { useEffect, useState, useSyncExternalStore } from 'react'
import { createBusinessStore } from '../services/business/store'
import { useAuth } from '../auth/authContext'

// One server cache per authenticated workspace. No demo/storage fallback.
export default function useProducts(suppliedStore) {
  const auth = useAuth()
  const [store] = useState(() => suppliedStore ?? createBusinessStore({ onUnauthorized: () => { void auth.restore() } }))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => { void store.start(); return () => store.dispose() }, [store])
  return { ...state, ...store, products: state.catalog.data ?? [],
    handleCreate: store.addProduct, handleUpdate: store.updateProduct, handleArchive: store.archiveProduct, handleRestore: store.restoreProduct }
}
