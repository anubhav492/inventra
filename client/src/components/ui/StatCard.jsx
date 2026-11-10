import { ArrowUpRight } from 'lucide-react'
export default function StatCard({ label, value, change, helperText, icon: Icon, tone }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon size={21} /></span></div><strong className="stat-value">{value}</strong><div className="stat-bottom">{change ? <><span className="stat-change"><ArrowUpRight size={14} />{change}</span><span>vs. last month</span></> : <span>{helperText}</span>}</div></article>
}
