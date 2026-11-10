import { useRef, useState } from 'react'
import { Building2, Database, Monitor, Moon, Paintbrush, Save, Sun, UserRound } from 'lucide-react'
import { validateWorkspaceName } from '../services/workspacePreferences'

const appearanceOptions = [
  { value: 'light', label: 'Light', description: 'A bright workspace', Icon: Sun },
  { value: 'dark', label: 'Dark', description: 'A darker workspace', Icon: Moon },
  { value: 'system', label: 'System', description: 'Match your device', Icon: Monitor },
]

export default function Settings({ theme, workspaceName, onThemeChange, onSaveWorkspace, notify, user }) {
  const [draftName, setDraftName] = useState(workspaceName)
  const [nameError, setNameError] = useState('')
  const [saving, setSaving] = useState(false)
  const nameInput = useRef(null)
  const submitLock = useRef(false)
  const hasChanges = draftName.trim() !== workspaceName

  async function handleSave(event) {
    event.preventDefault()
    if (submitLock.current || !hasChanges) return
    const error = validateWorkspaceName(draftName)
    if (error) {
      setNameError(error)
      notify(error, 'error')
      nameInput.current?.focus()
      return
    }
    submitLock.current = true
    setSaving(true)
    try {
      const savedName = await onSaveWorkspace(draftName)
      setDraftName(savedName)
      setNameError('')
      notify('Workspace name saved.')
    } catch (failure) {
      const message = failure.message || 'Could not save your workspace name. Please try again.'
      setNameError(message)
      notify(message, 'error')
      nameInput.current?.focus()
    } finally {
      submitLock.current = false
      setSaving(false)
    }
  }

  return <div className="settings-content">
    <section className="panel settings-card" aria-labelledby="appearance-title">
      <div className="settings-section-heading"><span className="stat-icon indigo"><Paintbrush size={20} /></span><div><h2 id="appearance-title">Appearance</h2><p>Choose how Inventra looks on this device.</p></div></div>
      <fieldset className="settings-theme-group"><legend className="sr-only">Theme preference</legend>{appearanceOptions.map(({ value, label, description, Icon }) => <label key={value} className={`settings-theme-choice ${theme.preference === value ? 'is-selected' : ''}`}>
        <input className="sr-only" type="radio" name="theme-preference" value={value} checked={theme.preference === value} onChange={() => onThemeChange(value)} />
        <div className="flex items-center justify-between gap-3"><Icon size={22} /><span className="settings-radio-indicator" aria-hidden="true" /></div><strong className="mt-4 block text-sm">{label}</strong><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{description}</span>
      </label>)}</fieldset>
      <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400" role="status">{theme.preference === 'system' ? `Following your device preference. Currently using ${theme.resolvedTheme} mode.` : `${theme.preference === 'dark' ? 'Dark' : 'Light'} mode is applied across Inventra.`}</p>
    </section>

    <section className="panel settings-card" aria-labelledby="workspace-title">
      <div className="settings-section-heading"><span className="stat-icon blue"><Building2 size={20} /></span><div><h2 id="workspace-title">Workspace Information</h2><p>Give your workspace a name that feels familiar.</p></div></div>
      <form className="grid gap-6" noValidate onSubmit={handleSave} aria-busy={saving}>
        <div className="grid gap-2"><label htmlFor="workspace-name" className="text-xs font-semibold">Workspace Name <span className="text-slate-400">*</span></label><input ref={nameInput} id="workspace-name" name="workspace_name" className="catalog-control" value={draftName} maxLength={60} required disabled={saving} aria-invalid={Boolean(nameError)} aria-describedby={`workspace-name-help${nameError ? ' workspace-name-error' : ''}`} onChange={event => { setDraftName(event.target.value); setNameError('') }} /><div id="workspace-name-help" className="flex justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400"><span>Required · Maximum 60 characters</span><span>{draftName.length}/60</span></div>{nameError && <p id="workspace-name-error" className="order-field-error" role="alert">{nameError}</p>}</div>
        <dl className="settings-readonly-list"><div><dt>Currency</dt><dd>INR — Indian Rupee (₹)</dd></div><div><dt>Application</dt><dd>Inventra</dd></div></dl>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500 dark:text-slate-400">Currency is fixed to INR for this workspace.</p><button type="submit" className="primary-button" disabled={!hasChanges || saving}><Save size={16} />{saving ? 'Saving…' : 'Save Changes'}</button></div>
      </form>
    </section>

    <section className="panel settings-card" aria-labelledby="account-title">
      <div className="settings-section-heading"><span className="stat-icon violet"><UserRound size={20} /></span><div><h2 id="account-title">Account</h2><p>Your signed-in Inventra account.</p></div></div>
      <dl className="settings-readonly-list"><div><dt>Account Name</dt><dd>{user?.name}</dd></div><div><dt>Email Address</dt><dd>{user?.email}</dd></div><div><dt>Account Status</dt><dd>Signed in</dd></div></dl>
    </section>

    <aside className="settings-data-note" aria-label="Data management information"><Database size={19} className="shrink-0" /><div><strong className="block text-xs font-semibold">Account data and browser preferences</strong><p className="mt-2 text-xs leading-relaxed">Products, inventory and orders are saved to your account on the server. Theme and workspace-name preferences remain in this browser.</p></div></aside>
  </div>
}
