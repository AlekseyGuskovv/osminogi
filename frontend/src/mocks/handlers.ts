import { http, HttpResponse } from 'msw'
import type { SnapshotRef } from '../api'
import type { FindingRecord, FindingReview, FindingsOverview } from '../findings/types'
import type { SnapshotComparison, SnapshotLibraryItem, SnapshotRun } from '../snapshots/types'
import type { Template } from '../templates/types'
import { nodeTypes } from '../workflow'
import type { Branch, ConnectionRef, Workflow, WorkflowDraft, WorkflowDraftResult } from '../workflow'
import { inspectZip } from './zip'
import { runEvents } from './events'
import { compareFindings, initialWorkflow, makeRun, snapshots } from './fixtures'
import type { Run } from '../runs/types'
import type { RunRequest } from '../runs/useRun'
import type { RunScenario } from './fixtures'

type StoredRun = { result: Run; at: string; readyAt: number; analyzers: string; workflow?: Workflow }

const workflowStorageKey = 'cyber-garden.mock.workflows.v2'

function loadWorkflows(): Workflow[] {
  try {
    const cached = globalThis.localStorage?.getItem(workflowStorageKey)
    if (cached) return JSON.parse(cached) as Workflow[]
  } catch {
    // A blocked or unavailable storage falls back to the initial demo data.
  }
  return [initialWorkflow]
}

const workflows = new Map(loadWorkflows().map(workflow => [workflow.id, workflow]))

function storeWorkflow(workflow: Workflow) {
  workflows.set(workflow.id, workflow)
  try {
    globalThis.localStorage?.setItem(workflowStorageKey, JSON.stringify([...workflows.values()]))
  } catch {
    // Keep the save available in memory if storage is blocked.
  }
}
const runStorageKey = 'cyber-garden.mock.runs.v2'
const runs = new Map<string, StoredRun>()
const reviewsStorageKey = 'cyber-garden.mock.finding-reviews.v1'
const reviews = new Map<string, FindingReview>()
try {
  const cached = globalThis.localStorage?.getItem(reviewsStorageKey)
  if (cached) for (const [key, review] of JSON.parse(cached) as [string, FindingReview][]) reviews.set(key, review)
} catch {
  // Keep reviews available in memory if storage is blocked.
}
const templateStorageKey = 'cyber-garden.mock.templates.v2'
const templates = new Map<string, Template>()
try {
  const cached = globalThis.localStorage?.getItem(templateStorageKey)
  if (cached) for (const template of JSON.parse(cached) as Template[]) templates.set(template.id, template)
} catch {
  // Keep the catalog available without persistence.
}
const connectionStorageKey = 'cyber-garden.mock.connections.v2'
const connections = new Map<string, ConnectionRef>([
  ['team-demo', { id: 'team-demo', type: 'telegram', name: 'Чат команды', configured: true }],
])
try {
  const saved = globalThis.localStorage?.getItem(connectionStorageKey)
  if (saved) for (const connection of JSON.parse(saved) as ConnectionRef[]) connections.set(connection.id, connection)
} catch {
  // Fall back to the demo connection without exposing request bodies.
}
function channelConfigured(id: unknown): boolean {
  return typeof id === 'string' && connections.get(id)?.configured === true
}

let nextTemplate = 1
const snapshotStorageKey = 'cyber-garden.mock.snapshots.v2'
const snapshotLabelsKey = 'cyber-garden.mock.snapshot-labels.v1'
let importedSnapshots: SnapshotRef[] = []
let snapshotLabels: Record<string, string> = {}
try {
  const saved = globalThis.localStorage?.getItem(snapshotStorageKey)
  if (saved) importedSnapshots = JSON.parse(saved) as SnapshotRef[]
  const labels = globalThis.localStorage?.getItem(snapshotLabelsKey)
  if (labels) snapshotLabels = JSON.parse(labels) as Record<string, string>
} catch {
  // Use the built-in demo snapshots when storage is unavailable.
}
const allSnapshots = (): SnapshotRef[] => [...snapshots, ...importedSnapshots].map(snapshot => ({
  ...snapshot, label: snapshotLabels[snapshot.id] ?? snapshot.label,
}))

const demoDependencies: Readonly<Record<string, string>> = {
  'main-1': '1.1.0', 'pr-1': '1.0.0', 'pr-2': '1.1.0', 'pr-3': '1.0.0',
}

let nextWorkflow = 2
let nextRun = 4
let nextPreview = 1
const fixPreviews = new Map<string, { runId: string; sourceSnapshotId: string }>()
const patchedSnapshots = new Set<string>()

const configuredBase: string | undefined = import.meta.env.VITE_API_BASE
const api = (path: string) => `${(configuredBase ?? '/api/v1').replace(/\/+$/, '')}${path}`

const mockCatalog = {
  source: 'training', analysisVersion: 'demo', osvAvailable: false, customAvailable: false, updating: false,
  osvUpdatedAt: null as string | null, refreshIntervalHours: 0, nextRefreshAt: null as string | null,
}
const mockAi = { mode: 'custom', checking: false, providers: [
  { id: 'demo', name: 'Демонстрационный AI', model: null, status: 'unknown' },
] }

function error(status: number, code: string, message: string) {
  return HttpResponse.json({ code, message }, { status })
}

function notFound(message: string) {
  return error(404, 'NOT_FOUND', message)
}

function invalidGraph() {
  return error(422, 'INVALID_GRAPH', 'Проверьте узлы и связи графа, включая обе ветки условия.')
}

function forTemplate(workflow: Workflow): Workflow {
  const { snapshotId: _snapshotId, ...graph } = workflow
  return {
    ...graph,
    schedule: null,
    nodes: graph.nodes.map(node => {
      if (node.type !== 'telegram') return node
      const settings = { ...node.settings }
      delete settings.channelId
      return { ...node, settings }
    }),
  }
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
  runs.set(id, { result: makeRun(id, workflow, request, scenario, channelConfigured), at, readyAt, analyzers, workflow })
}

storeRun('run-existing', initialWorkflow, { trigger: 'ci', baseSnapshotId: 'main-critical', snapshotId: 'pr-1' }, '2026-11-20T09:00:00Z', 0)
storeRun('run-1', initialWorkflow, { trigger: 'ci', baseSnapshotId: 'main-1', snapshotId: 'pr-1' }, '2026-11-20T10:00:00Z', 0)
storeRun('run-2', initialWorkflow, { trigger: 'ci', baseSnapshotId: 'main-1', snapshotId: 'pr-2' }, '2026-11-20T11:00:00Z', 0)
storeRun('run-3', initialWorkflow, { trigger: 'ci', baseSnapshotId: 'main-1', snapshotId: 'pr-3' }, '2026-11-20T12:00:00Z', 0)

try {
  const cached = globalThis.localStorage?.getItem(runStorageKey)
  if (cached) {
    for (const run of JSON.parse(cached) as StoredRun[]) runs.set(run.result.id, run)
  }
} catch {
  // The initial demo runs are still available when storage is unavailable.
}

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

function snapshotRuns(snapshotId: string): SnapshotRun[] {
  return [...runs.values()].reverse().flatMap(stored => {
    const run = runResponse(stored)
    if (run.snapshotId !== snapshotId && run.baseSnapshotId !== snapshotId) return []
    return [{ id: run.id, workflowId: run.workflowId, createdAt: stored.at, status: run.status,
      ci: run.ci.status, role: run.snapshotId === snapshotId ? 'current' : 'base' }]
  })
}

function completedFindingRuns(workflowId: string) {
  return [...runs.values()].reverse().filter(run => run.result.workflowId === workflowId &&
    Date.now() >= run.readyAt && (run.result.ci.status === 'passed' || run.result.ci.status === 'failed'))
}

function overviewFor(workflowId: string): FindingsOverview {
  const completed = completedFindingRuns(workflowId)
  const latest = completed[0]
  const records = new Map<string, FindingRecord>()
  for (const run of completed) {
    for (const finding of run.result.findings) {
      const record = records.get(finding.id)
      if (record) {
        record.firstSeenAt = run.at
        record.occurrences++
        continue
      }
      records.set(finding.id, {
        finding, category: finding.category ?? finding.ruleId.split('-')[0],
        state: run === latest ? 'open' : run.analyzers === latest.analyzers ? 'resolved' : 'unverified',
        firstSeenAt: run.at, lastSeenAt: run.at, lastSeenRunId: run.result.id, occurrences: 1,
        recommendation: run.result.recommendations.find(item => item.findingId === finding.id) ?? null,
        review: reviews.get(`${workflowId}/${finding.id}`) ?? null,
      })
    }
  }
  return { latestRunId: latest?.result.id ?? null, findings: [...records.values()] }
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
  http.get(api('/snapshots'), () => HttpResponse.json(allSnapshots())),
  http.get(api('/snapshots/library'), () => {
    const library: SnapshotLibraryItem[] = allSnapshots().reverse().map(snapshot => {
      const history = snapshotRuns(snapshot.id)
      return { ...snapshot, runCount: history.length, latestRun: history.find(run => run.role === 'current') ?? null }
    })
    return HttpResponse.json(library)
  }),
  http.get(api('/snapshots/:id/runs'), ({ params }) => {
    const id = String(params.id)
    if (!allSnapshots().some(snapshot => snapshot.id === id)) return notFound('Снимок не найден.')
    return HttpResponse.json(snapshotRuns(id))
  }),
  http.get(api('/snapshots/:id/comparison'), ({ params, request }) => {
    const id = String(params.id)
    const baseId = new URL(request.url).searchParams.get('againstSnapshotId')
    if (!baseId || id === baseId) return error(422, 'INVALID_SNAPSHOT_COMPARISON', 'Выберите два разных снимка.')
    if (![id, baseId].every(key => allSnapshots().some(snapshot => snapshot.id === key))) return notFound('Снимок не найден.')
    const before = demoDependencies[baseId]
    const after = demoDependencies[id]
    if (!before || !after) return error(422, 'DEMO_COMPARISON_UNAVAILABLE', 'Для сравнения загруженных архивов подключите бэкенд.')
    const comparison: SnapshotComparison = {
      baseSnapshotId: baseId, snapshotId: id,
      files: { added: [], modified: before === after ? [] : ['build.gradle.kts'], removed: [] },
      dependencies: before === after ? [] : [{ module: '.', group: 'demo', artifact: 'sample-library', before: [before], after: [after] }],
      unresolvedBefore: 0, unresolvedAfter: 0,
    }
    return HttpResponse.json(comparison)
  }),
  http.post(api('/snapshots/:id/rename'), async ({ params, request }) => {
    const id = String(params.id)
    const snapshot = allSnapshots().find(item => item.id === id)
    if (!snapshot) return notFound('Снимок не найден.')
    const label = (await readBody(request))?.label
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 160) {
      return error(422, 'INVALID_SNAPSHOT_LABEL', 'Укажите имя снимка длиной от 1 до 160 символов.')
    }
    snapshotLabels[id] = label.trim()
    try {
      globalThis.localStorage?.setItem(snapshotLabelsKey, JSON.stringify(snapshotLabels))
    } catch {
      // The new label is available for this page.
    }
    return HttpResponse.json({ ...snapshot, label: snapshotLabels[id] })
  }),
  http.post(api('/snapshots/import'), async ({ request }) => {
    const form = await request.formData().catch(() => undefined)
    const file = form?.get('file')
    if (!(file instanceof File)) return error(422, 'INVALID_ARCHIVE', 'Передайте ZIP-архив в поле file.')
    const issue = await inspectZip(file)
    if (issue === 'ARCHIVE_TOO_LARGE') {
      return error(413, issue, 'Лимит ZIP — 20 МБ, до 100 МБ после распаковки и до 5000 файлов.')
    }
    if (issue) return error(422, issue, 'ZIP-архив пуст, повреждён или содержит недопустимые файлы.')
    const snapshot = { id: `upload-${crypto.randomUUID()}`, label: file.name.slice(0, -4), createdAt: new Date().toISOString() }
    importedSnapshots.push(snapshot)
    try {
      globalThis.localStorage?.setItem(snapshotStorageKey, JSON.stringify(importedSnapshots))
    } catch {
      // Keep the imported snapshot available on this page.
    }
    return HttpResponse.json(snapshot, { status: 201 })
  }),
  http.get(api('/advisory-catalog'), () => HttpResponse.json(mockCatalog)),
  http.post(api('/advisory-catalog/source'), async ({ request }) => {
    const source = (await readBody(request))?.source
    if (source !== 'training' && !(source === 'osv' && mockCatalog.osvAvailable)) {
      return error(422, 'INVALID_CATALOG_SOURCE', 'Выберите доступный справочник.')
    }
    mockCatalog.source = source
    mockCatalog.analysisVersion = source === 'osv' ? 'demo-osv' : 'demo'
    return HttpResponse.json(mockCatalog)
  }),
  http.post(api('/advisory-catalog/refresh'), () => {
    mockCatalog.osvAvailable = true
    mockCatalog.osvUpdatedAt = new Date().toISOString()
    return HttpResponse.json(mockCatalog, { status: 202 })
  }),
  http.post(api('/advisory-catalog/schedule'), async ({ request }) => {
    const hours = (await readBody(request))?.refreshIntervalHours
    if (hours !== 0 && hours !== 24 && hours !== 168) return error(422, 'INVALID_CATALOG_SCHEDULE', 'Укажите период обновления.')
    mockCatalog.refreshIntervalHours = hours
    mockCatalog.nextRefreshAt = hours ? new Date(Date.now() + hours * 3600000).toISOString() : null
    return HttpResponse.json(mockCatalog)
  }),
  http.get(api('/settings/ai'), () => HttpResponse.json(mockAi)),
  http.post(api('/settings/ai/test'), () => {
    mockAi.providers[0].status = 'available'
    return HttpResponse.json(mockAi, { status: 202 })
  }),
  http.get(api('/settings/storage'), () => HttpResponse.json({ databaseBytes: 0, snapshotBytes: 0, runBytes: 0,
    snapshotCount: allSnapshots().length, runCount: runs.size })),
  http.get(api('/settings/storage/backup'), () => error(422, 'DEMO_BACKUP_UNAVAILABLE', 'Для резервной копии подключите бэкенд.')),
  http.get(api('/connections'), () => HttpResponse.json([...connections.values()])),
  http.post(api('/connections/:id/edit'), async ({ params, request }) => {
    const connection = connections.get(String(params.id))
    if (!connection) return notFound('Подключение Telegram не найдено.')
    const body = await readBody(request)
    const updated = { ...connection, name: typeof body?.name === 'string' ? body.name.trim() : connection.name,
      configured: typeof body?.configured === 'boolean' ? body.configured : connection.configured }
    connections.set(updated.id, updated)
    try { globalThis.localStorage?.setItem(connectionStorageKey, JSON.stringify([...connections.values()])) } catch {
      // Keep the edit available on this page.
    }
    return HttpResponse.json(updated)
  }),
  http.post(api('/connections/:id/test'), ({ params }) => channelConfigured(params.id)
    ? HttpResponse.json({ messageId: 1 }) : error(409, 'CONNECTION_DISABLED', 'Включите подключение перед проверкой.')),
  http.post(api('/connections'), async ({ request }) => {
    const body = await readBody(request)
    if (body?.type !== 'telegram' || typeof body.name !== 'string' || !body.name.trim() ||
      typeof body.chatId !== 'string' || !body.chatId.trim() || typeof body.token !== 'string' || !body.token.trim()) {
      return error(422, 'INVALID_REQUEST', 'Укажите название, Chat ID и токен бота.')
    }
    // The demo needs only public metadata for its simulated delivery.
    const connection: ConnectionRef = {
      id: `telegram-${crypto.randomUUID()}`, type: 'telegram', name: body.name.trim(), configured: true,
    }
    connections.set(connection.id, connection)
    try {
      globalThis.localStorage?.setItem(connectionStorageKey, JSON.stringify([...connections.values()]))
    } catch {
      // Keep the connection available in this page.
    }
    return HttpResponse.json(connection, { status: 201 })
  }),
  http.get(api('/templates'), () => HttpResponse.json([...templates.values()])),
  http.get(api('/templates/:templateId'), ({ params }) => {
    const template = templates.get(String(params.templateId))
    return template ? HttpResponse.json(template) : notFound('Шаблон не найден.')
  }),
  http.post(api('/templates'), async ({ request }) => {
    const body = await readBody(request)
    const workflow = typeof body?.workflowId === 'string' ? workflows.get(body.workflowId) : undefined
    if (!workflow) return notFound('Сценарий не найден.')
    if (typeof body?.name !== 'string' || !body.name.trim() || typeof body.description !== 'string') {
      return error(422, 'INVALID_REQUEST', 'Укажите название и описание шаблона.')
    }
    while (templates.has(`tpl-${nextTemplate}`)) nextTemplate++
    const template: Template = { id: `tpl-${nextTemplate++}`, name: body.name, description: body.description, workflow: forTemplate(workflow) }
    templates.set(template.id, template)
    try {
      globalThis.localStorage?.setItem(templateStorageKey, JSON.stringify([...templates.values()]))
    } catch {
      // Keep the publication available in this page.
    }
    return HttpResponse.json(template, { status: 201 })
  }),
  http.post(api('/templates/:templateId/copy'), ({ params }) => {
    const template = templates.get(String(params.templateId))
    if (!template) return notFound('Шаблон не найден.')
    while (workflows.has(`wf-${nextWorkflow}`)) nextWorkflow++
    const workflow: Workflow = { ...forTemplate(template.workflow), id: `wf-${nextWorkflow++}`, revision: 1, name: template.name }
    storeWorkflow(workflow)
    return HttpResponse.json(workflow, { status: 201 })
  }),
  http.get(api('/workflows'), () => HttpResponse.json([...workflows.values()])),
  http.get(api('/workflows/:workflowId'), ({ params }) => {
    const workflow = workflows.get(String(params.workflowId))
    return workflow ? HttpResponse.json(workflow) : notFound('Сценарий не найден.')
  }),
  http.post(api('/workflows/draft'), async ({ request }) => {
    const body = await readBody(request)
    if (typeof body?.prompt !== 'string' || !body.prompt.trim()) {
      return error(422, 'INVALID_REQUEST', 'Опишите, что должен проверить сценарий.')
    }
    const prompt = body.prompt.toLowerCase()
    const time = /\b(?:[01]\d|2[0-3]):[0-5]\d\b/.exec(prompt)?.[0]
    const scheduled = time || /расписан|каждый день|ежеднев|daily|schedule/.test(prompt)
    const wantsEmail = /\be-?mail\b|почт/.test(prompt)
    const { nodes, edges } = forTemplate(initialWorkflow)
    const draft: WorkflowDraftResult = {
      name: 'Черновик проверки проекта',
      schedule: scheduled ? { time: time ?? '09:00', timezone: 'Europe/Moscow' } : null,
      nodes,
      edges,
      warnings: wantsEmail ? ['Доступен Telegram. Выберите канал, если хотите получать уведомления.'] : [],
    }
    return HttpResponse.json(draft)
  }),
  http.post(api('/workflows'), async ({ request }) => {
    const body = await readBody(request)
    const draft = body && readDraft(body)
    if (!draft) return invalidGraph()

    while (workflows.has(`wf-${nextWorkflow}`)) nextWorkflow++
    const workflow: Workflow = { ...draft, id: `wf-${nextWorkflow++}`, revision: 1 }
    storeWorkflow(workflow)
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
    storeWorkflow(saved)
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
    if (typeof snapshotId !== 'string' || !allSnapshots().some(snapshot => snapshot.id === snapshotId)) {
      return notFound('Снимок проекта не найден.')
    }
    const baseSnapshotId = body?.baseSnapshotId
    if (baseSnapshotId !== undefined && baseSnapshotId !== 'main-critical' &&
      !allSnapshots().some(snapshot => snapshot.id === baseSnapshotId)) {
      return notFound('Базовый снимок проекта не найден.')
    }
    const trigger = body?.trigger
    if (trigger !== 'ci' && trigger !== 'manual' && trigger !== 'schedule') {
      return error(422, 'INVALID_TRIGGER', 'Укажите способ запуска сценария.')
    }

    while (runs.has(`run-${nextRun}`)) nextRun++
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
    try {
      globalThis.localStorage?.setItem(runStorageKey, JSON.stringify([...runs.values()].filter(run => run.readyAt > 0)))
    } catch {
      // The accepted run remains accessible from this page.
    }
    return HttpResponse.json({ id, status: 'queued' }, { status: 202 })
  }),
  http.get(api('/workflows/:workflowId/runs'), ({ params }) => {
    const id = String(params.workflowId)
    if (!workflows.has(id)) return notFound('Сценарий не найден.')
    return HttpResponse.json(
      [...runs.values()].reverse().filter(run => run.result.workflowId === id).map(runResponse),
    )
  }),
  http.get(api('/workflows/:workflowId/findings'), ({ params }) => {
    const workflowId = String(params.workflowId)
    if (!workflows.has(workflowId)) return notFound('Сценарий не найден.')
    return HttpResponse.json(overviewFor(workflowId))
  }),
  http.post(api('/workflows/:workflowId/findings/:findingId/review'), async ({ params, request }) => {
    const workflowId = String(params.workflowId)
    const findingId = String(params.findingId)
    if (!workflows.has(workflowId)) return notFound('Сценарий не найден.')
    const body = await readBody(request)
    const status = body?.status
    const reason = body?.reason === undefined ? '' : body.reason
    if ((status !== 'unreviewed' && status !== 'in_progress' && status !== 'false_positive') ||
      typeof reason !== 'string' || reason.trim().length > 500) {
      return error(422, 'INVALID_FINDING_REVIEW', 'Проверьте статус и причину.')
    }
    if (status === 'false_positive' && !reason.trim()) {
      return error(422, 'FINDING_REVIEW_REASON_REQUIRED', 'Укажите, почему это ложное срабатывание.')
    }
    if (!completedFindingRuns(workflowId).some(run => run.result.findings.some(finding => finding.id === findingId))) {
      return notFound('Находка не найдена в этом сценарии.')
    }
    const review: FindingReview = { findingId, status, reason: reason.trim(), updatedAt: new Date().toISOString() }
    reviews.set(`${workflowId}/${findingId}`, review)
    try {
      globalThis.localStorage?.setItem(reviewsStorageKey, JSON.stringify([...reviews]))
    } catch {
      // Keep this review available in memory if storage is blocked.
    }
    return HttpResponse.json(review)
  }),
  http.get(api('/workflows/:workflowId/findings/:findingId/history'), ({ params }) => {
    const workflowId = String(params.workflowId)
    const findingId = String(params.findingId)
    if (!workflows.has(workflowId)) return notFound('Сценарий не найден.')
    const completed = [...runs.values()].filter(run =>
      run.result.workflowId === workflowId && run.result.id !== 'run-existing' &&
      runResponse(run).status === 'succeeded',
    )
    const first = completed.find(run => run.result.findings.some(finding => finding.id === findingId))
    if (!first) return notFound('Находка не найдена.')

    const entries: { runId: string; state: 'found' | 'resolved' | 'returned' }[] = []
    let present = false
    for (const run of completed) {
      if (run.analyzers !== first.analyzers) continue
      const found = run.result.findings.some(finding => finding.id === findingId)
      if (present !== found) {
        entries.push({ runId: run.result.id, state: found ? (entries.length ? 'returned' : 'found') : 'resolved' })
        present = found
      }
    }
    return HttpResponse.json({ findingId, entries })
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
  http.post(api('/runs/:runId/threshold-preview'), async ({ params, request }) => {
    const run = runs.get(String(params.runId))
    if (!run) return notFound('Запуск не найден.')
    const body = await readBody(request)
    const workflow = run.workflow ?? workflows.get(run.result.workflowId)
    const { nodeId, value } = body ?? {}
    const severity = ['low', 'medium', 'high', 'critical']
    if (typeof nodeId !== 'string' || !workflow?.nodes.some(node => node.id === nodeId && node.type === 'condition')) {
      return notFound('Условие не найдено.')
    }
    const threshold = typeof value === 'string' ? severity.indexOf(value) : -1
    if (threshold === -1 || runResponse(run).status !== 'succeeded') {
      return error(422, 'INVALID_GRAPH', 'Предпросмотр требует завершённого анализа и допустимого порога.')
    }
    const branch = run.result.findings.some(finding => severity.indexOf(finding.severity) >= threshold) ? 'yes' : 'no'
    let next = workflow.edges.find(edge => edge.from === nodeId && edge.branch === branch)?.to
    const visited = new Set<string>()
    let wouldNotify = false
    while (next && !visited.has(next)) {
      visited.add(next)
      const node = workflow.nodes.find(item => item.id === next)
      if (node?.type === 'telegram' && channelConfigured(node.settings.channelId)) {
        wouldNotify = true
        break
      }
      next = workflow.edges.find(edge => edge.from === next && edge.branch === 'next')?.to
    }
    return HttpResponse.json({ nodeId, value, branch, wouldNotify })
  }),
  http.post(api('/runs/:runId/fix-preview'), async ({ params, request }) => {
    const run = runs.get(String(params.runId))
    if (!run) return notFound('Запуск не найден.')
    const body = await readBody(request)
    const finding = run.result.findings.find(item => item.id === body?.findingId)
    if (run.result.snapshotId !== 'pr-1' || finding?.id !== 'F-key' || runResponse(run).status !== 'succeeded') {
      return error(422, 'FIX_UNAVAILABLE', 'Для этой находки нет подготовленного учебного исправления.')
    }
    const previewId = `fix-${nextPreview++}`
    fixPreviews.set(previewId, { runId: run.result.id, sourceSnapshotId: run.result.snapshotId })
    return HttpResponse.json({
      previewId,
      path: finding.path,
      before: finding.evidence,
      after: 'api-key: ${DEMO_API_KEY}',
    })
  }),
  http.post(api('/runs/:runId/apply-fix'), async ({ params, request }) => {
    const runId = String(params.runId)
    if (!runs.has(runId)) return notFound('Запуск не найден.')
    const body = await readBody(request)
    const preview = typeof body?.previewId === 'string' ? fixPreviews.get(body.previewId) : undefined
    if (!preview || preview.runId !== runId || patchedSnapshots.has(preview.sourceSnapshotId)) {
      return error(409, 'STALE_PREVIEW', 'Предпросмотр устарел. Обновите снимок перед применением.')
    }
    patchedSnapshots.add(preview.sourceSnapshotId)
    return HttpResponse.json({ snapshotId: 'pr-2' }, { status: 201 })
  }),
  http.get(api('/runs/:runId/events'), ({ params, request }) => {
    const run = runs.get(String(params.runId))
    if (!run) return notFound('Запуск не найден.')
    return runEvents(run.result, run.at, run.readyAt, request.headers.get('Last-Event-ID'))
  }),
]
