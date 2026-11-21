import type { RunEvent } from '../runs/events.ts'
import type { Workflow } from '../workflow.ts'
import { emptyReplay } from './playback.ts'
import type { ReplayLog } from './playback.ts'

export type DemoScenario = 'critical' | 'fixed'

const steps = [
  ['demo-start', 'start', 'Начало проверки'],
  ['demo-secrets', 'secrets', 'Первичная проверка'],
  ['demo-sca', 'sca', 'Первичная проверка'],
  ['demo-sast', 'sast', 'Первичная проверка'],
  ['demo-secrets-extra', 'secrets', 'Учебный проход 2'],
  ['demo-sca-extra', 'sca', 'Учебный проход 2'],
  ['demo-sast-extra', 'sast', 'Учебный проход 2'],
  ['demo-ai', 'ai', 'Учебный анализ'],
  ['demo-ai-extra', 'ai', 'Учебные рекомендации'],
  ['demo-gate', 'condition', 'Проверка критичности'],
  ['demo-telegram', 'telegram', 'Симуляция доставки'],
  ['demo-finish', 'finish', 'Итог проверки'],
] as const

export const demoDetails = new Map<string, string>(steps.map(([id, , detail]) => [id, detail]))
const route = steps.map(([id]) => id)

export const longDemoWorkflow: Workflow = {
  id: 'local-long-demo',
  revision: 1,
  name: 'Расширенная проверка безопасности · Demo',
  schedule: null,
  nodes: steps.map(([id, type], index) => ({
    id, type, x: index * 215, y: type === 'telegram' ? 145 : 0,
    settings: type === 'condition' ? { metric: 'maxSeverity', operator: 'gte', value: 'critical' } : {},
  })),
  edges: [
    ...route.slice(0, 9).map((from, index) => ({ from, to: route[index + 1], branch: 'next' as const })),
    { from: 'demo-gate', to: 'demo-telegram', branch: 'yes' },
    { from: 'demo-gate', to: 'demo-finish', branch: 'no' },
    { from: 'demo-telegram', to: 'demo-finish', branch: 'next' },
  ],
}

function createReplay(scenario: DemoScenario): ReplayLog {
  const runId = `local-long-demo-${scenario}`
  const failed = scenario === 'critical'
  const events: RunEvent[] = []
  function add(event: Omit<Extract<RunEvent, { type: 'node.status' }>, 'runId' | 'seq' | 'at'> |
    Omit<Extract<RunEvent, { type: 'run.status' }>, 'runId' | 'seq' | 'at'> |
    Omit<Extract<RunEvent, { type: 'run.finished' }>, 'runId' | 'seq' | 'at'>) {
    events.push({ ...event, runId, seq: events.length + 1, at: '' })
  }

  add({ type: 'run.status', data: { status: 'running' } })
  for (const nodeId of route) {
    if (nodeId === 'demo-telegram' && !failed) continue
    add({ type: 'node.status', data: { nodeId, status: 'running' } })
    if (nodeId === 'demo-gate' && !failed) {
      add({ type: 'node.status', data: { nodeId: 'demo-telegram', status: 'skipped' } })
    }
    add({ type: 'node.status', data: { nodeId, status: 'succeeded',
      output: nodeId === 'demo-gate' ? { branch: failed ? 'yes' : 'no' } : undefined } })
  }
  add({ type: 'run.finished', data: { status: 'succeeded', ciStatus: failed ? 'failed' : 'passed' } })
  return { ...emptyReplay(runId), events, source: 'simulation' }
}

export const longDemoLogs = { critical: createReplay('critical'), fixed: createReplay('fixed') }
