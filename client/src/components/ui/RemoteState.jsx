import { LoaderCircle } from 'lucide-react'
export default function RemoteState({ resource, onRetry, children }) {
  if (resource.error) return <div className="panel grid gap-4 p-6" role="alert"><p>{resource.error}</p><button type="button" className="secondary-button justify-self-start" onClick={onRetry}>Try again</button></div>
  if (resource.data === null) return <div className="panel flex items-center gap-3 p-6" role="status"><LoaderCircle className="auth-spinner" size={20} />Loading…</div>
  return <>{resource.loading && <p className="mb-3 text-xs muted" role="status">Refreshing…</p>}{children}</>
}
