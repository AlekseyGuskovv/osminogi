import { http, HttpResponse } from 'msw'
import { runEvents } from './events'
import { baselineFindings, initialRuns, initialWorkflow, makeRun, snapshots } from './fixtures'
import type { RunScenario } from './fixtures'

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }
type Workflow = { id: string; name: string; revision: number; graph: Graph }
type Run = ReturnType<typeof makeRun>
type StoredRun = { result: Run; readyAt: number }

const workflows = new Map<string, Workflow>([[initialWorkflow.id, initialWorkflow]])
const runs = new Map<string, StoredRun>(
  [...initialRuns].reverse().map(run => [run.id, { result: run, readyAt: 0 }]),
)
let nextWorkflow = 2
let nextRun = 4

const configuredBase: string | undefined = import.meta.env.VITE_API_BASE
const api = (path: string) => `${(configuredBase ?? '/api/v1').replace(/\/+$/, '')}${path}`

function notFound(message: string) {
  return HttpResponse.json({ code: 'NOT_FOUND', message }, { status: 404 })
}

function invalidGraph() {
  return HttpResponse.json(
    { code: 'INVALID_GRAPH', message: 'Проверьте узлы и связи графа.' },
    { status: 422 },
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const value: unknown = await request.json().catch(() => undefined)
  return isRecord(value) ? value : undefined
}

function isGraph(value: unknown): value is Graph {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return false
  }

  const nodeIds = new Set<string>()
  for (const node of value.nodes as unknown[]) {
    if (!isRecord(node) || typeof node.id !== 'string' || !node.id || nodeIds.has(node.id)) {
      return false
    }
    nodeIds.add(node.id)
  }

  return (value.edges as unknown[]).every(edge =>
    isRecord(edge) &&
    typeof edge.source === 'string' && nodeIds.has(edge.source) &&
    typeof edge.target === 'string' && nodeIds.has(edge.target),
  )
}

function runResponse({ result, readyAt }: StoredRun) {
  if (Date.now() >= readyAt) {
    return result
  }

  const { id, workflowId, snapshotId, createdAt } = result
  return { id, workflowId, snapshotId, createdAt, status: 'queued' }
}

function scenarioFor(request: Request): RunScenario {
  const scenario = new URL(request.url).searchParams.get('scenario')
  switch (scenario) {
    case 'empty':
    case 'scan-failed':
    case 'ai-failed':
    case 'telegram-failed':
      return scenario
    default:
      return 'default'
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
    const graph = body?.graph ?? { nodes: [], edges: [] }
    if (!body || !isGraph(graph)) {
      return invalidGraph()
    }

    const workflow: Workflow = {
      id: `wf-${nextWorkflow++}`,
      name: typeof body.name === 'string' ? body.name : 'Новый сценарий',
      revision: 1,
      graph,
    }
    workflows.set(workflow.id, workflow)
    return HttpResponse.json(workflow, { status: 201 })
  }),
  http.post(api('/workflows/:workflowId/save'), async ({ params, request }) => {
    const id = String(params.workflowId)
    const body = await readBody(request)
    const workflow = workflows.get(id)
    if (!workflow) {
      return notFound('Сценарий не найден.')
    }
    if (!body || !isGraph(body.graph)) {
      return invalidGraph()
    }
    const expectedRevision = body.revision ?? body.expectedRevision
    if (expectedRevision !== undefined && expectedRevision !== workflow.revision) {
      return HttpResponse.json(
        { code: 'REVISION_CONFLICT', message: 'Сценарий уже изменён. Загрузите актуальную ревизию.' },
        { status: 409 },
      )
    }
    const saved: Workflow = {
      ...workflow,
      name: typeof body.name === 'string' ? body.name : workflow.name,
      graph: body.graph,
      revision: workflow.revision + 1,
    }
    workflows.set(id, saved)
    return HttpResponse.json(saved)
  }),
  http.post(api('/workflows/:workflowId/runs'), async ({ params, request }) => {
    const workflowId = String(params.workflowId)
    if (!workflows.has(workflowId)) {
      return notFound('Сценарий не найден.')
    }
    const body = await readBody(request)
    const snapshotId = body?.snapshotId ?? 'pr-1'
    if (typeof snapshotId !== 'string' || !snapshots.some(snapshot => snapshot.id === snapshotId)) {
      return notFound('Снимок проекта не найден.')
    }
    const id = `run-${nextRun++}`
    const now = Date.now()
    const result = makeRun(id, workflowId, snapshotId, scenarioFor(request), new Date(now).toISOString())
    runs.set(id, { result, readyAt: now + 600 })
    return HttpResponse.json({ id, status: 'queued' }, { status: 202 })
  }),
  http.get(api('/workflows/:workflowId/runs'), ({ params }) => {
    const id = String(params.workflowId)
    if (!workflows.has(id)) {
      return notFound('Сценарий не найден.')
    }
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
    if (!run) {
      return notFound('Запуск не найден.')
    }

    const againstRunId = new URL(request.url).searchParams.get('againstRunId')
    const previous = againstRunId ? runs.get(againstRunId) : undefined
    if (againstRunId && (!previous || previous.result.workflowId !== run.result.workflowId)) {
      return notFound('Запуск для сравнения не найден.')
    }

    const current = run.result.findings
    const baseline = previous?.result.findings ?? baselineFindings
    const currentIds = new Set<string>(current.map(finding => finding.id))
    const baselineIds = new Set<string>(baseline.map(finding => finding.id))
    return HttpResponse.json({
      runId: run.result.id,
      ...(againstRunId ? { againstRunId } : { baselineSnapshotId: 'main-1' }),
      new: current.filter(finding => !baselineIds.has(finding.id)),
      existing: current.filter(finding => baselineIds.has(finding.id)),
      resolved: baseline.filter(finding => !currentIds.has(finding.id)),
    })
  }),
  http.get(api('/runs/:runId/events'), ({ params, request }) => {
    const run = runs.get(String(params.runId))
    if (!run) {
      return notFound('Запуск не найден.')
    }
    return runEvents(run.result, request.headers.get('Last-Event-ID'))
  }),
]
