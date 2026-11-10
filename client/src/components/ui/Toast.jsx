import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, CircleAlert, X } from 'lucide-react'

function subscribeToDialogs(onChange) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
  return () => observer.disconnect()
}
const getToastRoot = () => document.querySelector('dialog[open]') ?? document.body

export default function Toast({ notice, onDismiss }) {
  const [paused, setPaused] = useState(false)
  const root = useSyncExternalStore(subscribeToDialogs, getToastRoot, () => null)
  const error = notice.type === 'error'
  useEffect(() => {
    if (error || paused) return
    const timer = setTimeout(onDismiss, 7000)
    return () => clearTimeout(timer)
  }, [error, paused, notice, onDismiss])

  const content = <div className={`toast ${error ? 'toast-error' : 'toast-success'}`} role={error ? 'alert' : 'status'}
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false) }}>
    {error ? <CircleAlert size={20} aria-hidden="true" /> : <CheckCircle2 size={20} aria-hidden="true" />}
    <span>{notice.message}</span><button type="button" className="icon-button" aria-label="Dismiss notification" onClick={onDismiss}><X size={18} /></button>
  </div>
  // Keep feedback visible and accessible above native dialogs, including failed submissions.
  return root ? createPortal(content, root) : content
}
