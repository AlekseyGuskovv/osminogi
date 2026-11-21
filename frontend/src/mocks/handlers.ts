import { http, HttpResponse } from 'msw'
import { runEvents } from './events'
import { compareFindings, initialWorkflow, makeRun, nodeTypes, snapshots } from './fixtures'
import type { Branch, Run, RunRequest, RunScenario, Workflow, WorkflowDraft } from './fixtures'

type StoredRun = { result: Run; at: string; readyAt: number; analyzers: string }

const workflows = new Map<string, Workflow>([[initialWorkflow.id, initialWorkflow]])
const runs = new Map<string, StoredRun>()
let nextWorkflow = 2
let nextRun = 4

const configuredBase: string | undefined = import.meta.env.VITE_API_BASE
const api = (path: string) => `${(configuredBase ?? '/api/v1').replace(/\/+$/, '')}${path}`

function error(status: number, code: string, message: string) {
  return HttpResponse.json({ code, message }, { status })
}

function notFound(message: string) {
  return error(404, 'NOT_FOUND', message)
}

function invalidGraph() {
  return error(422, 'INVALID_GRAPH', 'Проверьте узлы и связи графа, включая обе ветки условия.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const value: unknown = await request.json().catch(() => undefined)
  return isRecord(value) ? value : undefined
}

function isNode(value: unknown): value is WorkflowDraft['nodes'][number] {
  return isRecord(value) &&
    typeof value.id === 'string' && value.id.length > 0 &&
    nodeTypes.some(type => type === value.type) &&
    typeof value.x === 'number' && Number.isFinite(value.x) &&
    typeof value.y === 'number' && Number.isFinite(value.y) &&
    isRecord(value.settings) && !('token' in value.settings)
}

function isEdge(value: unknown): value is WorkflowDraft['edges'][number] {
  return isRecord(value) &&
    typeof value.from === 'string' && typeof value.to === 'string' &&
    (value.branch === 'next' || value.branch === 'yes' || value.branch === 'no')
}

function isValidGraph(nodes: WorkflowDraft['nodes'], edges: WorkflowDraft['edges']) {
  const outgoing = new Map(nodes.map(node => [node.id, new Map<Branch, string>()]))
  const starts = nodes.filter(node => node.type === 'start')
  if (outgoing.size !== nodes.length || starts.length !== 1) {
    return false
  }

  for (const { from, to, branch } of edges) {
    const links = outgoing.get(from)
    if (!links || !outgoing.has(to) || to === starts[0].id || links.has(branch)) {
      return false
    }
    links.set(branch, to)
  }

  for (const node of nodes) {
    const links = outgoing.get(node.id)!
    if (node.type === 'condition') {
      if (links.size !== 2 || !links.has('yes') || !links.has('no')) return false
    } else if (node.type === 'finish' || (node.type === 'telegram' && links.size === 0)) {
      // The reference Workflow ends its yes branch at the Telegram block.
      if (links.size !== 0) return false
    } else if (links.size !== 1 || !links.has('next')) {
      return false
    }
  }

  const visited = new Set<string>()
  const active = new Set<string>()
  function visit(id: string): boolean {
    if (active.has(id)) return false
    if (visited.has(id)) return true
    active.add(id)
    for (const target of outgoing.get(id)!.values()) {
      if (!visit(target)) return false
    }
    active.delete(id)
    visited.add(id)
    return true
  }

  return visit(starts[0].id) && visited.size === nodes.length
}

function readDraft(body: Record<string, unknown>): WorkflowDraft | undefined {
  const { name, schedule, nodes, edges, snapshotId } = body
  if (
    typeof name !== 'string' ||
    !(schedule === null || (isRecord(schedule) && typeof schedule.time === 'string' && typeof schedule.timezone === 'string')) ||
    !Array.isArray(nodes) || !nodes.every(isNode) ||
    !Array.isArray(edges) || !edges.every(isEdge) ||
    (snapshotId !== undefined && typeof snapshotId !== 'string') ||
    !isValidGraph(nodes, edges)
  ) {
    return
  }

  return {
    name,
    schedule: schedule === null ? null : { time: String(schedule.time), timezone: String(schedule.timezone) },
    nodes,
    edges,
    ...(snapshotId === undefined ? {} : { snapshotId }),
  }
}

function storeRun(
  id: string,
  workflow: Workflow,
  request: RunRequest,
  at: string,
  readyAt: number,
  scenario?: RunScenario,
) {
  const analyzers = [...new Set(workflow.nodes
    .map(node => node.type)
    .filter(type => type === 'secrets' || type === 'sca' || type === 'sast'))].sort().join(',')
  runs.set(id, { result: makeRun(id, workflow, request, scenario), at, readyAt, analyzers })
}

storeRun('run-existing', initialWorkflow, { trigger: 'ci', baseSnapshotId: 'main-critical', snapshotId: 'pr-1' }, '2026-11-20T09:00:00Z', 0)
storeRun('run-1', initialWorkflow, { trigger: 'ci', baseSnapshotId: 'main-1', snapshotId: 'pr-1' }, '2026-11-20T10:00:00Z', 0)
storeRun('run-2', initialWorkflow, { trigger: 'ci', baseSnapshotId: 'main-1', snapshotId: 'pr-2' }, '2026-11-20T11:00:00Z', 0)
storeRun('run-3', initialWorkflow, { trigger: 'ci', baseSnapshotId: 'main-1', snapshotId: 'pr-3' }, '2026-11-20T12:00:00Z', 0)

function runResponse({ result, readyAt }: StoredRun): Run {
  if (Date.now() >= readyAt) return result
  return {
    ...result,
    status: 'queued',
    comparison: { introduced: [], existing: [], resolved: [] },
    findings: [],
    ci: { status: 'pending' },
    recommendations: [],
    delivery: 'skipped',
    report: { summary: '', delivery: 'skipped' },
    steps: [],
  }
}

function scenarioFor(request: Request): RunScenario | undefined {
  const scenario = new URL(request.url).searchParams.get('scenario')
  switch (scenario) {
    case 'empty':
    case 'scanError':
    case 'aiError':
    case 'telegramError':
      return scenario
  }
}

export const handlers = [
  http.get(api('/snapshots'), () => HttpResponse.json(snapshots)),
  http.get(api('/workflows'), () => HttpResponse.json([...workflows.values()])),
  http.get(api('/workflows/:workflowId'), ({ params }) => {
    const workflow = workflows.get(String(params.workflowId))
    return workflow ? HttpResponse.json(workflow) : notFound('Сценарий не найден.')
  }),
  http.post(api('/workflows'), async ({ request }) => {
    const body = await readBody(request)
    const draft = body && readDraft(body)
    if (!draft) return invalidGraph()

    const workflow: Workflow = { ...draft, id: `wf-${nextWorkflow++}`, revision: 1 }
    workflows.set(workflow.id, workflow)
    return HttpResponse.json(workflow, { status: 201 })
  }),
  http.post(api('/workflows/:workflowId/save'), async ({ params, request }) => {
    const id = String(params.workflowId)
    const body = await readBody(request)
    const workflow = workflows.get(id)
    if (!workflow) return notFound('Сценарий не найден.')
    if (!body) return invalidGraph()
    if (body.revision !== workflow.revision) {
      return error(409, 'REVISION_CONFLICT', 'Сценарий уже изменён. Загрузите актуальную ревизию.')
    }
    const draft = readDraft(body)
    if (!draft) return invalidGraph()

    const saved: Workflow = { ...draft, id, revision: workflow.revision + 1 }
    workflows.set(id, saved)
    return HttpResponse.json(saved)
  }),
  http.post(api('/workflows/:workflowId/runs'), async ({ params, request }) => {
    const workflow = workflows.get(String(params.workflowId))
    if (!workflow) return notFound('Сценарий не найден.')
    const body = await readBody(request)
    const snapshotId = body?.snapshotId ?? workflow.snapshotId
    if (snapshotId === undefined || snapshotId === '') {
      return error(422, 'SNAPSHOT_REQUIRED', 'Выберите снимок проекта перед запуском.')
    }
    if (typeof snapshotId !== 'string' || !snapshots.some(snapshot => snapshot.id === snapshotId)) {
      return notFound('Снимок проекта не найден.')
    }
    const baseSnapshotId = body?.baseSnapshotId
    if (baseSnapshotId !== undefined && baseSnapshotId !== 'main-critical' &&
      !snapshots.some(snapshot => snapshot.id === baseSnapshotId)) {
      return notFound('Базовый снимок проекта не найден.')
    }
    const trigger = body?.trigger
    if (trigger !== 'ci' && trigger !== 'manual' && trigger !== 'schedule') {
      return error(422, 'INVALID_TRIGGER', 'Укажите способ запуска сценария.')
    }

    const id = `run-${nextRun++}`
    const now = Date.now()
    storeRun(
      id,
      workflow,
      { trigger, snapshotId, ...(typeof baseSnapshotId === 'string' ? { baseSnapshotId } : {}) },
      new Date(now).toISOString(),
      now + 600,
      scenarioFor(request),
    )
    return HttpResponse.json({ id, status: 'queued' }, { status: 202 })
  }),
  http.get(api('/workflows/:workflowId/runs'), ({ params }) => {
    const id = String(params.workflowId)
    if (!workflows.has(id)) return notFound('Сценарий не найден.')
    return HttpResponse.json(
      [...runs.values()].reverse().filter(run => run.result.workflowId === id).map(runResponse),
    )
  }),
  http.get(api('/runs/:runId'), ({ params }) => {
    const run = runs.get(String(params.runId))
    return run ? HttpResponse.json(runResponse(run)) : notFound('Запуск не найден.')
  }),
  http.get(api('/runs/:runId/comparison'), ({ params, request }) => {
    const run = runs.get(String(params.runId))
    if (!run) return notFound('Запуск не найден.')
    const current = runResponse(run)

    const againstRunId = new URL(request.url).searchParams.get('againstRunId')
    if (!againstRunId) return HttpResponse.json(current.comparison)
    const previous = runs.get(againstRunId)
    if (!previous) return notFound('Запуск для сравнения не найден.')

    const baseline = runResponse(previous)
    if (
      baseline.workflowId !== current.workflowId ||
      baseline.status !== 'succeeded' ||
      current.status !== 'succeeded' ||
      run.analyzers !== previous.analyzers
    ) {
      return error(409, 'INCOMPARABLE_RUNS', 'Запуски нельзя сравнить по результатам анализа.')
    }
    return HttpResponse.json({ againstRunId, ...compareFindings(current.findings, baseline.findings) })
  }),
  http.get(api('/runs/:runId/events'), ({ params, request }) => {
    const run = runs.get(String(params.runId))
    if (!run) return notFound('Запуск не найден.')
    return runEvents(run.result, run.at, run.readyAt, request.headers.get('Last-Event-ID'))
  }),
]
