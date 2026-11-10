import StatusBadge from '../ui/StatusBadge'
import { orderStatuses } from '../../utils/orders'

export default function OrderStatus({ status }) {
  const [label, tone] = orderStatuses[status]
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}
