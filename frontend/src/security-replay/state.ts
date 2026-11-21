import type { RunView } from '../runs/useRun.ts'
import type { Run } from '../runs/types.ts'
import type { WorkflowDraft } from '../workflow.ts'

type Edge = WorkflowDraft['edges'][number]

export function branchOf(output: unknown): 'yes' | 'no' | undefined {
  if (!output || typeof output !== 'object' || !('branch' in output)) return
  if (output.branch === 'yes' || output.branch === 'no') return output.branch
}

export function pulseFor(edge: Edge, view?: RunView) {
  const source = view?.nodes[edge.from]
  const branch = source?.branch ?? branchOf(source?.output)
  const choice = edge.branch !== 'next' && branch
    ? edge.branch === branch ? 'taken' : 'alternate'
    : undefined
  const event = view?.lastNodeEvent
  const pulse = view?.status === 'running' && event?.id === edge.from && choice === 'taken' && branchOf(event.output) === branch
    ? event.seq
    : undefined
  return { choice, pulse }
}

export function ciSummary(run: Run) {
  if (run.ci.status === 'error') return 'Анализ завершился ошибкой. Решение по находкам недоступно.'
  if (run.ci.status === 'passed') return run.ci.reason === 'NO_CRITICAL'
    ? 'Критических находок в этом запуске нет.' : 'Проверка безопасности пройдена.'
  if (run.ci.status === 'failed') return run.ci.reason === 'CRITICAL_FOUND'
    ? 'Проверка безопасности не пройдена из-за критической находки.' : 'Проверка безопасности не пройдена.'
  return 'Решение CI ещё не получено.'
}
