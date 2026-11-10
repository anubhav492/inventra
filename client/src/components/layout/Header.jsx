import { LogOut, Menu, Moon, PanelLeftClose, Plus, Sun, UserRound } from 'lucide-react'
export default function Header({ title, subtitle, menuOpen, theme, onMenu, onPrimaryAction, actionLabel = 'New Order', onThemeToggle, showPrimaryAction = true, onLogout, logoutPending }) {
  const themeLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  return <header className="header">
    <div className="header-heading">
      <button id="sidebar-toggle" className="sidebar-toggle icon-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-controls="workspace-sidebar" aria-expanded={menuOpen} title={menuOpen ? 'Close navigation' : 'Open navigation'} onClick={onMenu}>{menuOpen ? <PanelLeftClose size={22} /> : <Menu size={22} />}</button>
      <div><h1 id="page-title" tabIndex={-1}>{title}</h1><p>{subtitle}</p></div>
    </div>
    <div className="header-actions">
      <button className="theme-toggle icon-button" aria-label={themeLabel} title={themeLabel} onClick={onThemeToggle}>{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>
      {showPrimaryAction && <button id="page-primary-action" className="primary-button" onClick={onPrimaryAction}><Plus size={18} /><span>{actionLabel}</span></button>}
      <a className="profile-button" href="#settings" aria-label="Open settings"><UserRound size={20} /></a>
      <button className="logout-button" type="button" disabled={logoutPending} onClick={onLogout} aria-label={logoutPending ? 'Signing out' : 'Sign out'}><LogOut size={17} /><span>{logoutPending ? 'Signing out…' : 'Sign out'}</span></button>
    </div>
  </header>
}
