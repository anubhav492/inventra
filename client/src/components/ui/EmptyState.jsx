export default function EmptyState({ icon: Icon, title, description, action, compact = false }) {
  return <div className={`empty-state ${compact ? 'empty-state--compact' : ''}`}>
    <span className="empty-state-icon" aria-hidden="true"><Icon size={24} /></span>
    <h3>{title}</h3>
    <p>{description}</p>
    {action && <div className="empty-state-action">{action}</div>}
  </div>
}
