export const snapshots = [
  { id: 'main-1', label: 'Основная ветка' },
  { id: 'pr-1', label: 'До правки' },
  { id: 'pr-2', label: 'После правки' },
  { id: 'pr-3', label: 'Риск вернулся' },
]

export const initialWorkflow = {
  id: 'wf-1',
  name: 'Проверка PR',
  revision: 1,
  graph: {
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'secrets', type: 'secrets' },
      { id: 'condition', type: 'condition' },
      { id: 'failed', type: 'end' },
      { id: 'passed', type: 'end' },
    ],
    edges: [
      { id: 'e-1', source: 'start', target: 'secrets' },
      { id: 'e-2', source: 'secrets', target: 'condition' },
      { id: 'e-3', source: 'condition', target: 'failed', branch: 'yes' },
      { id: 'e-4', source: 'condition', target: 'passed', branch: 'no' },
    ],
  },
}

const dependency = { id: 'F-dep', severity: 'high', title: 'Уязвимая зависимость' } as const
const secret = { id: 'F-key', severity: 'critical', title: 'Ключ в исходном коде' } as const

export const baselineFindings = [dependency]
export type Finding = typeof dependency | typeof secret

export type RunScenario = 'default' | 'empty' | 'scan-failed' | 'ai-failed' | 'telegram-failed'

export function makeRun(
  id: string,
  workflowId: string,
  snapshotId: string,
  scenario: RunScenario,
  createdAt: string,
) {
  const scanFailed = scenario === 'scan-failed'
  const hasCritical = !scanFailed && scenario !== 'empty' && ['pr-1', 'pr-3'].includes(snapshotId)
  const findings: Finding[] = scanFailed || scenario === 'empty'
    ? []
    : hasCritical ? [secret, dependency] : [...baselineFindings]
  const ci = scanFailed
    ? { status: 'error', reason: 'SCAN_FAILED' } as const
    : hasCritical
      ? { status: 'failed', reason: 'CRITICAL_FOUND' } as const
      : { status: 'passed', reason: 'NO_CRITICAL' } as const

  return {
    id,
    workflowId,
    snapshotId,
    createdAt,
    status: scanFailed ? 'failed' as const : 'succeeded' as const,
    ci,
    findings,
    ...(scanFailed ? { error: { code: 'SCAN_FAILED', message: 'Не удалось завершить сканирование.' } } : {}),
    recommendations: findings.map(finding => ({
      findingId: finding.id,
      source: scenario === 'ai-failed' ? 'rule' : 'ai',
      message: finding.id === 'F-key' ? 'Отзовите ключ и удалите его из исходного кода.' : 'Обновите зависимость.',
    })),
    telegram: { delivery: scenario === 'telegram-failed' ? 'failed' : 'sent' },
  }
}

export const initialRuns = [
  makeRun('run-3', 'wf-1', 'pr-3', 'default', '2026-11-20T12:00:00Z'),
  makeRun('run-2', 'wf-1', 'pr-2', 'default', '2026-11-20T11:00:00Z'),
  makeRun('run-1', 'wf-1', 'pr-1', 'default', '2026-11-20T10:00:00Z'),
]
