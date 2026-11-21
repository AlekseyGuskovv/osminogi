import type { Ci, Comparison, Finding, Run, Step } from '../runs/types'
import type { RunRequest } from '../runs/useRun'
import type { Workflow } from '../workflow'

export const snapshots = [
  { id: 'main-1', label: 'Основная ветка' },
  { id: 'pr-1', label: 'До правки' },
  { id: 'pr-2', label: 'После правки' },
  { id: 'pr-3', label: 'Риск вернулся' },
]

export const initialWorkflow: Workflow = {
  id: 'wf-1',
  revision: 1,
  name: 'Проверка перед слиянием',
  schedule: null,
  nodes: [
    { id: 'start', type: 'start', x: 40, y: 45, settings: {} },
    { id: 'secret', type: 'secrets', x: 245, y: 45, settings: {} },
    { id: 'deps', type: 'sca', x: 450, y: 45, settings: {} },
    { id: 'code', type: 'sast', x: 655, y: 45, settings: {} },
    { id: 'ai', type: 'ai', x: 655, y: 165, settings: {} },
    { id: 'gate', type: 'condition', x: 430, y: 165, settings: { metric: 'maxSeverity', operator: 'gte', value: 'critical' } },
    { id: 'tg', type: 'telegram', x: 215, y: 285, settings: { channelId: 'team-demo' } },
    { id: 'end', type: 'finish', x: 655, y: 285, settings: {} },
  ],
  edges: [
    { from: 'start', to: 'secret', branch: 'next' },
    { from: 'secret', to: 'deps', branch: 'next' },
    { from: 'deps', to: 'code', branch: 'next' },
    { from: 'code', to: 'ai', branch: 'next' },
    { from: 'ai', to: 'gate', branch: 'next' },
    { from: 'gate', to: 'tg', branch: 'yes' },
    { from: 'gate', to: 'end', branch: 'no' },
  ],
}

const keyFinding = {
  id: 'F-key',
  ruleId: 'SECRET-01',
  nodeId: 'secret',
  severity: 'critical',
  title: 'Ключ в настройках',
  path: 'src/main/resources/application.yml',
  line: 12,
  evidence: 'api-key: ••••',
  advisoryId: null,
} as const

const dependencyFinding = {
  id: 'F-dep',
  ruleId: 'SCA-01',
  nodeId: 'deps',
  severity: 'high',
  title: 'Обновите учебную библиотеку',
  path: 'build.gradle.kts',
  line: 18,
  evidence: 'demo:sample-library:1.0.0',
  advisoryId: 'DEMO-001',
} as const

export type RunScenario = 'empty' | 'scanError' | 'aiError' | 'telegramError'

export function compareFindings(current: Finding[], baseline: Finding[]): Comparison {
  const currentIds = new Set<string>(current.map(finding => finding.id))
  const baselineIds = new Set<string>(baseline.map(finding => finding.id))
  return {
    introduced: [...currentIds].filter(id => !baselineIds.has(id)),
    existing: [...currentIds].filter(id => baselineIds.has(id)),
    resolved: [...baselineIds].filter(id => !currentIds.has(id)),
  }
}

export function findingsFor(workflow: Workflow, snapshotId: string): Finding[] {
  const secrets = workflow.nodes.find(node => node.type === 'secrets')
  const dependency = workflow.nodes.find(node => node.type === 'sca')
  const findings: Finding[] = []
  if (secrets && ['pr-1', 'pr-3', 'main-critical'].includes(snapshotId)) {
    findings.push({ ...keyFinding, nodeId: secrets.id, line: snapshotId === 'pr-3' ? 16 : 12 })
  }
  if (dependency) {
    findings.push({ ...dependencyFinding, nodeId: dependency.id })
  }
  return findings
}

export function makeRun(id: string, workflow: Workflow, request: RunRequest, scenario?: RunScenario): Run {
  const { snapshotId, baseSnapshotId } = request
  const findings = scenario === 'empty' || scenario === 'scanError' ? [] : findingsFor(workflow, snapshotId)
  const baseline = baseSnapshotId && scenario !== 'empty' && scenario !== 'scanError'
    ? findingsFor(workflow, baseSnapshotId)
    : []
  const comparison = compareFindings(findings, baseline)
  const critical = findings.find(finding => finding.severity === 'critical')
  const gate = workflow.nodes.find(node => node.type === 'condition')
  const branch = critical ? 'yes' : 'no'
  const scanFailed = scenario === 'scanError'
  const ci: Ci = scanFailed
    ? { status: 'error', reason: 'SCAN_FAILED' }
    : {
        status: critical ? 'failed' : 'passed',
        reason: critical ? 'CRITICAL_FOUND' : 'NO_CRITICAL',
        findingId: critical?.id ?? null,
        nodeId: critical?.nodeId ?? null,
        gateNodeId: gate?.id ?? null,
        branch: gate ? branch : null,
      }
  const telegram = workflow.nodes.find(node => node.type === 'telegram')
  const delivery = !scanFailed && critical && telegram
    ? scenario === 'telegramError' ? 'failed' : 'sent'
    : 'skipped'
  const steps: Step[] = []
  if (scanFailed) {
    const failed = workflow.nodes.find(node => node.type === 'sca') ??
      workflow.nodes.find(node => node.type === 'secrets')
    if (failed) {
      steps.push({
        nodeId: failed.id,
        status: 'failed',
        error: { code: 'SCAN_FAILED', message: 'Не удалось проверить зависимости.' },
      })
    }
  } else {
    const secret = workflow.nodes.find(node => node.type === 'secrets')
    const finish = workflow.nodes.find(node => node.type === 'finish')
    if (secret) steps.push({ nodeId: secret.id, status: 'succeeded' })
    if (gate) steps.push({ nodeId: gate.id, status: 'succeeded', branch })
    if (telegram) steps.push({ nodeId: telegram.id, status: delivery === 'skipped' ? 'skipped' : delivery === 'failed' ? 'failed' : 'succeeded' })
    if (finish) steps.push({ nodeId: finish.id, status: delivery === 'skipped' ? 'succeeded' : 'skipped' })
  }

  return {
    id,
    workflowId: workflow.id,
    workflowRevision: workflow.revision,
    ...request,
    status: scanFailed ? 'failed' : 'succeeded',
    comparison,
    findings,
    ci,
    recommendations: critical
      ? [{
          findingId: critical.id,
          source: scenario === 'aiError' ? 'rule' : 'ai',
          explanation: scenario === 'aiError' ? 'Значение хранится в файле.' : 'Ключ виден в настройках.',
          action: scenario === 'aiError' ? 'Используйте переменную окружения.' : 'Перенесите значение в переменную окружения.',
        }]
      : [],
    delivery,
    report: {
      summary: scanFailed ? 'Не удалось завершить анализ.' : critical ? 'Найдена одна критическая проблема.' : 'Критических проблем не найдено.',
      delivery,
    },
    steps,
  }
}
