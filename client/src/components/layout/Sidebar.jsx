import { useEffect, useRef } from 'react'
import { Boxes, Building2, LayoutDashboard, Package, Warehouse, ShoppingCart, Settings, X } from 'lucide-react'

const navigation = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['products', 'Products', Package],
  ['inventory', 'Inventory', Warehouse],
  ['orders', 'Orders', ShoppingCart],
]

export default function Sidebar({ activePage, open, onClose, onNavigate, workspaceName }) {
  const sidebarRef = useRef(null)
  useEffect(() => {
    if (!open || !window.matchMedia('(max-width: 700px)').matches) return
    const sidebar = sidebarRef.current
    sidebar.querySelector('[aria-current="page"]')?.focus()
    const keepFocusInNavigation = event => {
      if (event.key !== 'Tab' || !window.matchMedia('(max-width: 700px)').matches) return
      const controls = [...sidebar.querySelectorAll('a[href], button:not([disabled])')].filter(element => element.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    sidebar.addEventListener('keydown', keepFocusInNavigation)
    return () => sidebar.removeEventListener('keydown', keepFocusInNavigation)
  }, [open])

  return <aside ref={sidebarRef} id="workspace-sidebar" aria-label="Workspace" inert={!open} className={`sidebar ${open ? 'is-open' : ''}`}>
    <div className="sidebar-brand-row"><a href="#dashboard" className="brand" onClick={onNavigate}><span className="brand-icon"><Boxes size={24} /></span>Inventra</a><button className="mobile-close icon-button" type="button" aria-label="Close navigation" onClick={onClose}><X size={20} /></button></div>
    <div className="workspace-label">Workspace</div>
    <nav aria-label="Main navigation">{navigation.map(([id, label, Icon]) => <a key={id} href={`#${id}`} onClick={onNavigate} className={`nav-item ${activePage === id ? 'active' : ''}`} aria-current={activePage === id ? 'page' : undefined}><Icon size={20} />{label}</a>)}</nav>
    <div className="sidebar-footer"><div className="sidebar-divider" /><a href="#settings" onClick={onNavigate} className={`nav-item ${activePage === 'settings' ? 'active' : ''}`} aria-current={activePage === 'settings' ? 'page' : undefined}><Settings size={20} />Settings</a><a href="#settings" onClick={onNavigate} className="workspace-account"><span className="avatar"><Building2 size={18} /></span><span><strong>{workspaceName}</strong><small>Signed-in workspace</small></span></a></div>
  </aside>
}
