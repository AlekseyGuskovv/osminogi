import type { CiStatus, RunStatus } from '../runs/events'

const runLabels = { queued: 'В очереди', running: 'Выполняется', succeeded: 'Завершён', failed: 'Ошибка' }
const ciLabels = { pending: 'Ожидается', passed: 'Пройден', failed: 'Не пройден', error: 'Ошибка анализа' }

export function StatusBadge(props: { status: RunStatus; kind: 'run' } | { status: CiStatus; kind: 'ci' }) {
  const label = props.kind === 'run' ? runLabels[props.status] : ciLabels[props.status]
  const { status } = props
  return <span className="garden-status" data-tone={status}><i aria-hidden="true" />{label}</span>
}
