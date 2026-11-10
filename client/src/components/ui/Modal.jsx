import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

export default function Modal({ title, description, onClose, children, wide = false }) {
  const dialogRef = useRef(null)
  const backdropPointer = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      // An archived row may have disappeared; return focus to the page action.
      if (previousFocus?.isConnected) previousFocus.focus()
      else (document.getElementById('page-primary-action') ?? document.getElementById('page-title'))?.focus()
    }
  }, [])

  return (
    <dialog ref={dialogRef} className={`modal product-modal ${wide ? 'order-modal' : ''}`} aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={event => { event.preventDefault(); onClose() }}
      onPointerDown={event => { backdropPointer.current = event.target === event.currentTarget }}
      onClick={event => { if (event.target === event.currentTarget && backdropPointer.current) onClose() }}>
      <div className="modal-body">
        <div className="panel-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>
        {description && <p id={descriptionId} className="form-intro">{description}</p>}
        {children}
      </div>
    </dialog>
  )
}
