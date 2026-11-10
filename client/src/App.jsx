import { useCallback, useEffect, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import Sidebar from './components/layout/Sidebar'
import Header from './components/layout/Header'
import Modal from './components/ui/Modal'
import Toast from './components/ui/Toast'
import RemoteState from './components/ui/RemoteState'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Inventory from './pages/Inventory'
import Orders from './pages/Orders'
import Settings from './pages/Settings'
import OrderForm from './components/forms/OrderForm'
import OrderDetails from './components/orders/OrderDetails'
import useProducts from './hooks/useProducts'
import useTheme from './hooks/useTheme'
import { readWorkspaceName, saveWorkspaceName } from './services/workspacePreferences'
import AuthGate from './auth/AuthGate'
import { useAuth } from './auth/authContext'
import { authErrorMessage } from './auth/authStore'
import './App.css'

const pages = {
  dashboard: ['Dashboard', 'Monitor your business operations'],
  products: ['Products', 'Manage your product catalog'],
  inventory: ['Inventory', 'Monitor stock levels and manage inventory'],
  orders: ['Orders', 'Manage customer orders and track fulfillment'],
  settings: ['Settings', 'Manage your account and workspace preferences'],
}
const currentPage = () => pages[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard'

export default function App({ businessStore } = {}) {
  const auth = useAuth()
  return <AuthGate><WorkspaceApp key={auth.user?.id} businessStore={businessStore} /></AuthGate>
}

function WorkspaceApp({ businessStore }) {
  const auth = useAuth()
  const [page, setPage] = useState(currentPage)
  const [menuOpen, setMenuOpen] = useState(() => !window.matchMedia('(max-width: 700px)').matches)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches)
  const theme = useTheme()
  const [workspaceName, setWorkspaceName] = useState(readWorkspaceName)
  const [orderOpen, setOrderOpen] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [productForm, setProductForm] = useState(null)
  const [inventoryDialog, setInventoryDialog] = useState(null)
  const [notice, setNotice] = useState(null)
  const catalog = useProducts(businessStore)
  const selectedOrder = catalog.orderDetail.data
  function viewOrder(id) { setSelectedOrderId(id); void catalog.loadOrder(id) }
  function createOrder() { setOrderOpen(true); void catalog.loadCatalog() }

  function notify(message, type = 'success') {
    setNotice({ message, type })
  }
  const dismissNotice = useCallback(() => setNotice(null), [])

  function changeTheme(preference) {
    const saved = preference === undefined ? theme.toggleTheme() : theme.selectTheme(preference)
    if (!saved) notify('Theme applied for this visit, but your preference could not be saved. Browser storage may be unavailable or full.', 'error')
  }

  function saveWorkspace(value) {
    const name = saveWorkspaceName(value)
    setWorkspaceName(name)
    return name
  }

  useEffect(() => {
    const update = () => {
      setPage(currentPage())
      setProductForm(null)
      setInventoryDialog(null)
      setOrderOpen(false)
      setSelectedOrderId(null)
      if (window.matchMedia('(max-width: 700px)').matches) setMenuOpen(false)
      requestAnimationFrame(() => document.getElementById('page-title')?.focus())
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const update = () => { setMenuOpen(!media.matches); setIsMobile(media.matches) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!menuOpen || !window.matchMedia('(max-width: 700px)').matches) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = event => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        setMenuOpen(false)
        requestAnimationFrame(() => document.getElementById('sidebar-toggle')?.focus())
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  return (
    <div className={`app-shell ${menuOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to main content</a>
      {menuOpen && <button className="sidebar-backdrop" tabIndex={-1} aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <Sidebar activePage={page} open={menuOpen} workspaceName={workspaceName} onClose={() => { setMenuOpen(false); requestAnimationFrame(() => document.getElementById('sidebar-toggle')?.focus()) }} onNavigate={() => { if (isMobile) { setMenuOpen(false); requestAnimationFrame(() => document.getElementById('page-title')?.focus()) } }} />
      <div className="main-shell" inert={isMobile && menuOpen}>
        <Header title={pages[page][0]} subtitle={pages[page][1]} menuOpen={menuOpen} theme={theme.resolvedTheme}
          logoutPending={auth.pending} onLogout={async () => { try { await auth.logout() } catch (error) { notify(authErrorMessage(error), 'error') } }}
          onThemeToggle={() => changeTheme()}
          onMenu={() => setMenuOpen(current => !current)}
          showPrimaryAction={page !== 'settings'}
          actionLabel={page === 'products' ? 'Add Product' : page === 'inventory' ? 'Restock Product' : 'Create Order'}
          onPrimaryAction={() => {
            setNotice(null)
            if (page === 'products') setProductForm({ mode: 'add' })
            else if (page === 'inventory') setInventoryDialog({ mode: 'restock' })
            else createOrder()
          }} />
        <main id="main-content" className="page-content" tabIndex={-1}>
          {catalog.warning && <p className="inventory-storage-warning" role="alert"><CircleAlert size={18} className="shrink-0" />{catalog.warning}</p>}
          {page === 'dashboard' ? <Dashboard catalog={catalog} onViewOrder={viewOrder} />
            : page === 'products' ? <RemoteState resource={catalog.catalog} onRetry={() => catalog.loadCatalog()}><Products catalog={catalog} form={productForm}
              onAdd={() => setProductForm({ mode: 'add' })} onEdit={id => { setProductForm({ mode: 'edit', id }); void catalog.loadProduct(id) }}
              onCloseForm={() => { if (!catalog.pending) setProductForm(null) }} notify={notify} /></RemoteState>
              : page === 'inventory' ? <RemoteState resource={catalog.catalog} onRetry={() => catalog.loadCatalog()}><Inventory catalog={catalog} dialog={inventoryDialog}
                onOpenDialog={setInventoryDialog} onCloseDialog={() => { if (!catalog.pending) setInventoryDialog(null) }} notify={notify} /></RemoteState>
              : page === 'orders' ? <Orders catalog={catalog} onViewOrder={viewOrder} onCreateOrder={createOrder} />
              : <Settings theme={theme} workspaceName={workspaceName} onThemeChange={changeTheme} onSaveWorkspace={saveWorkspace} notify={notify} user={auth.user} />}
        </main>
      </div>
      {orderOpen && <Modal wide title="Create order" description="Select products and quantities. Stock is deducted when the order is placed." onClose={() => { if (!catalog.pending) setOrderOpen(false) }}><RemoteState resource={catalog.catalog} onRetry={() => catalog.loadCatalog()}><OrderForm catalog={catalog} notify={notify} onCancel={() => setOrderOpen(false)} onSuccess={order => {
        setOrderOpen(false)
        notify(`${order.id} placed. Inventory and movement history updated.`)
      }} /></RemoteState></Modal>}
      {selectedOrderId && (selectedOrder && selectedOrder.id === selectedOrderId && !catalog.orderDetail.error
        ? <OrderDetails key={selectedOrder.id} order={selectedOrder} catalog={catalog} onClose={() => setSelectedOrderId(null)} notify={notify} />
        : <Modal title="Order details" onClose={() => setSelectedOrderId(null)}><RemoteState resource={catalog.orderDetail} onRetry={() => catalog.loadOrder(selectedOrderId)} /></Modal>)}
      {notice && <Toast notice={notice} onDismiss={dismissNotice} />}
    </div>
  )
}

