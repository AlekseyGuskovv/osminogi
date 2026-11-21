import { Background, BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, getSmoothStepPath, useNodesState } from '@xyflow/react'
import type { Connection, Edge, EdgeProps, Node, NodeChangeset, NodeProps, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { DragEvent } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiUrl, getJson, postJson } from '../api'
import type { SnapshotRef } from '../api'
import { getHighlight } from '../runs/ci'
import type { Run } from '../runs/types'
import { runsUrl } from '../runs/navigation'
import { useStartRun } from '../runs/useRun'
import { nodeTypes } from '../workflow'
import type { NodeType, Workflow } from '../workflow'
import { newWorkflow, saveDraft } from './useWorkflow'
import type { EditableWorkflow } from './useWorkflow'
import { SnapshotPicker } from './SnapshotPicker'
import { DraftDialog } from './DraftDialog'
import { NodeCatalog } from './NodeCatalog'
import { AdvisoryPanel } from './AdvisoryPanel'
import { NodeSettings } from './NodeSettings'
import { addNode, connect, removeNode } from './graph'
import '@xyflow/react/dist/style.css'
import { Icon } from '../ui/Icon'
import { WorkspaceNav } from '../ui/WorkspaceNav'
import { orderGraph } from './layout'
import { ExplainableCI } from '../security-replay/ExplainableCI'
import { LongDemoPanel } from '../security-replay/LongDemoPanel'
import { demoDetails, longDemoLogs, longDemoWorkflow } from '../security-replay/longDemo'
import type { DemoScenario } from '../security-replay/longDemo'
import { PresentationMode } from '../security-replay/PresentationMode'
import { usePresentation } from '../security-replay/usePresentation'
import { branchChoice, branchOf } from '../security-replay/state'
import { reconstructRoute } from '../security-replay/reconstruction'
import type { Playback } from '../security-replay/usePlayback'
import { HolographicActivation } from '../security-replay/HolographicActivation'
import { PlaybackControls } from '../security-replay/PlaybackControls'
import { usePlayback } from '../security-replay/usePlayback'
import { useRecordedRun } from '../security-replay/useRecordedRun'
import type { PlaybackSpeed } from '../security-replay/playback'
import { newNodeSize, placeNode } from './placement'
import type { Point } from './graph'

const paletteMime = 'application/x-cyber-garden-node'

const labels = {
  start: ['Запуск', 'Начало сценария', 'terminal'],
  secrets: ['Поиск секретов', 'Токены и ключи', 'analysis'],
  sca: ['Зависимости', 'Состав проекта', 'analysis'],
  sast: ['Анализ кода', 'Статический анализ', 'analysis'],
  gradle: ['Gradle', 'Настройки сборки', 'analysis'],
  coverage: ['Покрытие', 'Что проверено', 'analysis'],
  ai: ['Рекомендации AI', 'Приоритизация рисков', 'ai'],
  condition: ['Условие', 'Развилка сценария', 'decision'],
  telegram: ['Telegram', 'Отправка отчёта и завершение', 'delivery'],
  finish: ['Завершение', 'Конец сценария', 'terminal'],
} as const

const palette = [
  { title: 'Поток', types: ['start', 'condition', 'finish'] },
  { title: 'Анализ', types: ['secrets', 'sca', 'sast', 'gradle', 'coverage'] },
  { title: 'Обработка', types: ['ai', 'telegram'] },
] as const

const noEdges: EditableWorkflow['edges'] = []

const severity = { critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий' }

function conditionLabel(settings: Record<string, unknown>) {
  if (settings.metric === 'findingCount') return `Находок ≥ ${String(settings.value ?? 1)}`
  if (settings.metric === 'findingTitle') return settings.value ? 'Совпадение по названию' : 'Шаблон не задан'
  const value = String(settings.value ?? 'critical')
  return `Риск ≥ ${severity[value as keyof typeof severity] ?? value}`
}

function fittedViewport(workflow: EditableWorkflow, width: number, height: number, minZoom = .2): Viewport {
  if (!workflow.nodes.length || width < 100 || height < 100) return { x: 0, y: 0, zoom: 1 }
  const left = Math.min(...workflow.nodes.map(node => node.x))
  const top = Math.min(...workflow.nodes.map(node => node.y))
  const graphWidth = Math.max(...workflow.nodes.map(node => node.x)) + 172 - left
  const graphHeight = Math.max(...workflow.nodes.map(node => node.y)) + 85 - top
  const zoom = Math.max(minZoom, Math.min(1.22, (width - 76) / graphWidth, (height - 76) / graphHeight))
  return {
    x: (width - graphWidth * zoom) / 2 - left * zoom,
    y: (height - graphHeight * zoom) / 2 - top * zoom,
    zoom,
  }
}

const statuses = { queued: 'В очереди', running: 'Выполняется', succeeded: 'Готово', failed: 'Ошибка', skipped: 'Пропущен' }
type Block = Node<{ kind: NodeType; detail?: string; status?: keyof typeof statuses; reconstructed?: boolean; activation?: { phase: 'running' | 'succeeded'; bindMotion: Playback['bindMotion']; key: string }; arrival?: boolean; branch?: 'yes' | 'no'; critical?: boolean; highlighted?: boolean; ciPassed?: boolean; muted?: boolean }, 'workflow'>
export type EditorProps = { workflowId?: string; ciRunId?: string; copiedTemplate?: boolean; explain?: boolean; replay?: boolean }

const WorkflowBlock = memo(function WorkflowBlock({ id, data, selected }: NodeProps<Block>) {
  const { kind } = data
  const [label, description, tone] = labels[kind]
  return (
    <div className={`garden-node ${selected ? 'selected' : ''}`} data-node-tone={tone} data-execution={data.reconstructed ? undefined : data.status} data-arrival={data.arrival || undefined} data-critical={data.critical || undefined} data-branch={data.branch} data-ci-passed={data.ciPassed || undefined} data-explain-muted={data.muted || undefined} data-ci-highlight={data.highlighted || undefined}>
      {data.activation && <HolographicActivation key={data.activation.key} id={id} phase={data.activation.phase} bindMotion={data.activation.bindMotion} />}
      {kind !== 'start' && <Handle type="target" position={Position.Left} aria-label="Вход" />}
      <span className="garden-icon"><Icon name={kind} size={17} /></span>
      <span className="garden-node-copy"><strong>{label}</strong><span>{data.detail ?? description}</span>
        {data.status && <small data-node-status={data.reconstructed ? undefined : data.status}>{data.reconstructed ? 'Маршрут · демо' : statuses[data.status]}{data.branch && ` · ${data.branch.toUpperCase()}`}</small>}
      </span>
      {kind === 'condition' ? <>
        <span className="garden-port yes" aria-hidden="true">YES</span>
        <span className="garden-port no" aria-hidden="true">NO</span>
        <Handle type="source" id="yes" position={Position.Right} style={{ top: '28%' }} aria-label="Выход YES" />
        <Handle type="source" id="no" position={Position.Right} style={{ top: '76%' }} aria-label="Выход NO" />
      </> : kind !== 'finish' && kind !== 'telegram' && <Handle type="source" id="next" position={Position.Right} aria-label="Выход" />}
    </div>
  )
})

const flowNodeTypes = { workflow: WorkflowBlock }

function WorkflowEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY } = props
  let [path] = getSmoothStepPath({ ...props, borderRadius: 8, offset: 19 })
  // Route a return connection on the same level outside both cards.
  if (sourceX > targetX && Math.abs(sourceY - targetY) < 18) {
    const lane = Math.min(sourceY, targetY) - 47
    path = `M ${sourceX},${sourceY}
      C ${sourceX + 23},${sourceY} ${sourceX + 23},${lane} ${sourceX},${lane}
      H ${targetX}
      C ${targetX - 23},${lane} ${targetX - 23},${targetY} ${targetX},${targetY}`
  }
  return <>
    <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd}
      interactionWidth={props.interactionWidth} />
    {props.data?.pulse === true && <g className="replay-edge-pulse" aria-hidden="true">
      <path d={path} className="pulse-edge-guide" />
      <path d={path} pathLength={100} className="pulse-edge-tail" />
      <path d={path} pathLength={100} className="pulse-edge-core" />
    </g>}
  </>
}

const flowEdgeTypes = { workflow: WorkflowEdge }


type FlowCanvasProps = {
  nodes: Block[]
  edges: Edge[]
  pending: boolean
  overview: boolean
  onInit: (instance: ReactFlowInstance<Block>) => void
  onMoveStart: (event: MouseEvent | TouchEvent | null) => void
  onPositionCommit: (positions: Map<string, { x: number; y: number }>) => void
  onConnect: (connection: Connection) => void
  onPickNode: (id: string) => void
  onPickEdge: (id: string) => void
  onClearSelection: () => void
}

const FlowCanvas = memo(function FlowCanvas({
  nodes, edges, pending, overview, onInit, onMoveStart, onPositionCommit, onConnect, onPickNode, onPickEdge, onClearSelection,
}: FlowCanvasProps) {
  const [localNodes, setLocalNodes] = useNodesState(nodes)
  useEffect(() => {
    setLocalNodes(current => {
      const existing = new Map(current.map(node => [node.id, node]))
      return nodes.map(node => {
        const previous = existing.get(node.id)
        // Dropping measured dimensions invalidates React Flow's cached handle bounds.
        return previous
          ? { ...node, measured: previous.measured, dragging: previous.dragging,
              position: previous.dragging ? previous.position : node.position }
          : node
      })
    })
  }, [nodes, setLocalNodes])

  const changeNodes = useCallback((changes: NodeChangeset<Block>) => {
    setLocalNodes(current => changes.applyTo(current))
    const committed = new Map(changes.getByType('position').flatMap(change =>
      change.position && change.dragging !== true ? [[change.id, change.position] as const] : [],
    ))
    if (committed.size) onPositionCommit(committed)
  }, [onPositionCommit, setLocalNodes])

  return <ReactFlow nodes={localNodes} edges={edges} nodeTypes={flowNodeTypes} edgeTypes={flowEdgeTypes}
    className="dark" minZoom={overview ? .08 : .2} maxZoom={2} zIndexMode="manual"
    nodesDraggable={!pending} nodesConnectable={!pending} elementsSelectable={!overview} deleteKeyCode={null}
    onInit={onInit} onMoveStart={onMoveStart} onNodesChange={changeNodes} onConnect={onConnect}
    onNodeClick={overview ? undefined : (_, node) => onPickNode(node.id)}
    onEdgeClick={overview ? undefined : (_, edge) => onPickEdge(edge.id)}
    onPaneClick={overview ? undefined : onClearSelection}>
    <Background color="#33464e" gap={24} size={1.2} />
    <Controls showInteractive={false} />
  </ReactFlow>
})

export function WorkflowEditor({ workflowId, ciRunId, copiedTemplate, explain, replay }: EditorProps) {
  const [workflow, setWorkflow] = useState<EditableWorkflow>()
  const [savedChoices, setSavedChoices] = useState<Workflow[]>([])
  const mock = import.meta.env.VITE_USE_MOCKS === 'true'
  const canvas = useRef<HTMLElement>(null)
  const inspector = useRef<HTMLElement>(null)
  const draftRef = useRef<EditableWorkflow | undefined>(undefined)
  const flow = useRef<ReactFlowInstance<Block>>(null)
  const cameraTouched = useRef(false)
  const [graphGeneration, setGraphGeneration] = useState(0)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [savedWorkflow, setSavedWorkflow] = useState<EditableWorkflow>()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [selectedEdge, setSelectedEdge] = useState('')
  const [ciRun, setCiRun] = useState<Run>()
  const [explanationOpen, setExplanationOpen] = useState(Boolean(explain))
  const [demoOpen, setDemoOpen] = useState(Boolean(replay))
  const [longDemo, setLongDemo] = useState(false)
  const [longStarted, setLongStarted] = useState(false)
  const [scenario, setScenario] = useState<DemoScenario>('critical')
  const [followReady, setFollowReady] = useState(false)
  const followTouched = useRef(false)
  const [training, setTraining] = useState<Run>()
  const [trainingBusy, setTrainingBusy] = useState(false)
  const [trainingError, setTrainingError] = useState('')
  const [demoStage, setDemoStage] = useState(0)
  const [demoCompareRun, setDemoCompareRun] = useState<Run>()
  const savedCamera = useRef<Viewport | undefined>(undefined)
  const [replayId, setReplayId] = useState(replay ? ciRunId ?? '' : '')
  const demo = usePresentation(demoOpen && !longDemo, demoStage, workflow?.id, replayId)
  const historicalRun = longDemo ? training : demoOpen ? demoCompareRun ?? demo.run : explanationOpen ? ciRun : undefined
  const recordedGraph = historicalRun?.graph
  const displayedWorkflow = useMemo(() => {
    if (longDemo && mock) return longDemoWorkflow
    if (recordedGraph && historicalRun) return {
      ...recordedGraph, name: longDemo ? 'Учебная проверка Kotlin' : workflow?.name ?? 'Сохранённый граф',
      id: historicalRun.id, schedule: null,
    }
    return longDemo ? undefined : workflow
  }, [longDemo, mock, recordedGraph, historicalRun, workflow])
  const reconstructed = useMemo(() => mock && demoStage === 0 && workflow && demo.run
    ? reconstructRoute(workflow, demo.run) : undefined, [mock, demoStage, workflow, demo.run])
  const [snapshots, setSnapshots] = useState<SnapshotRef[]>([])
  const [draftWarnings, setDraftWarnings] = useState<string[]>([])
  const [snapshotId, setSnapshotId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const { start, starting, accepted, clearAccepted } = useStartRun()
  const pending = saving || starting
  const { view: runView, log: liveLog } = useRecordedRun(accepted?.id)
  const { log: historicalLog } = useRecordedRun(!mock && demoOpen && (longDemo || demoStage === 0) ? historicalRun?.id : undefined)
  const [speed, setSpeed] = useState<PlaybackSpeed>(replay && !mock ? 2 : 1)
  const playbackLog = demoOpen
    ? mock ? longDemo ? longStarted ? longDemoLogs[scenario] : undefined : reconstructed : historicalLog
    : liveLog
  const playback = usePlayback(playbackLog, displayedWorkflow?.edges ?? noEdges, speed, canvas, demoOpen)
  const runStatus = runView?.status ?? accepted?.status
  const visualFinished = playback.event?.type === 'run.finished' && !playback.playing
  const visualRun = !demoOpen && (!liveLog || visualFinished) ? runView : playback.view
  const playbackView = playback.view
  const activationRunId = playbackView?.status === 'succeeded' || playbackView?.status === 'failed' ? undefined : playbackView?.id
  const activation = useMemo(() => activationRunId ? {
    bindMotion: playback.bindMotion, key: `${activationRunId}:${playback.repetition}`,
  } : undefined, [activationRunId, playback.bindMotion, playback.repetition])
  const activeEvent = playback.event?.type === 'node.status' ? playback.event : undefined
  const pulseNode = activeEvent && (playback.playing || activeEvent.data.status === 'running') ? activeEvent.data.nodeId : undefined
  const factCi = demoOpen ? demo.run?.ci : runView?.ci
  const criticalNode = factCi?.reason === 'CRITICAL_FOUND' ? factCi.nodeId : undefined
  const criticalFinding = factCi?.reason === 'CRITICAL_FOUND' ? factCi.findingId : undefined
  const activeDemoNode = displayedWorkflow?.nodes.find(node => node.id === (playback.edge?.from ?? pulseNode))
  const activeLabel = activeDemoNode && labels[activeDemoNode.type][0]
  const explanationRun = demoOpen && demoStage === 1 ? demo.run : explanationOpen ? ciRun : undefined
  const highlightRun = longDemo ? undefined : demoOpen ? demoStage === 3 ? demoCompareRun : explanationRun : ciRun
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
  const dirty = workflow && (!workflow.id || JSON.stringify({ ...workflow, snapshotId: snapshotId || null }) !==
    JSON.stringify({ ...savedWorkflow, snapshotId: savedWorkflow?.snapshotId || null }))
  const hasStart = workflow?.nodes.some(node => node.type === 'start')
  const activeNode = displayedWorkflow?.nodes.find(node => node.id === selectedId)
  const activeNodeView = demoOpen ? playbackView?.nodes[selectedId] : runView?.nodes[selectedId]
  const missingChannel = workflow?.nodes.find(node => node.type === 'telegram' && !node.settings.channelId)
  const highlight = useMemo(
    () => highlightRun?.workflowId === workflow?.id && highlightRun ? getHighlight(highlightRun.ci) : undefined,
    [highlightRun, workflow?.id],
  )

  useEffect(() => { draftRef.current = workflow }, [workflow])
  const fit = useCallback((draft: EditableWorkflow) => {
    const element = canvas.current
    if (!element) return
    const header = element.querySelector<HTMLElement>('.garden-canvas-header')
    void flow.current?.setViewport(fittedViewport(draft, element.clientWidth, element.clientHeight - (header?.offsetHeight ?? 0), draft.id === longDemoWorkflow.id ? .08 : .2))
  }, [])

  const initializeFlow = useCallback((instance: ReactFlowInstance<Block>) => {
    flow.current = instance
    if (draftRef.current && !cameraTouched.current) fit(draftRef.current)
  }, [fit])

  useEffect(() => {
    if (!demoOpen) return
    const frame = requestAnimationFrame(() => {
      if (draftRef.current) fit(draftRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [demoOpen, fit])

  useEffect(() => {
    if ((!longDemo && !recordedGraph) || !displayedWorkflow) return
    const frame = requestAnimationFrame(() => fit(displayedWorkflow))
    const timer = setTimeout(() => setFollowReady(true), 850)
    return () => { cancelAnimationFrame(frame); clearTimeout(timer) }
  }, [longDemo, recordedGraph, displayedWorkflow, fit])

  useEffect(() => {
    if (!longDemo || !followReady || !activeDemoNode || playback.paused || followTouched.current ||
      matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const instance = flow.current
    const element = canvas.current
    if (!instance || !element) return
    const viewport = instance.getViewport()
    const right = element.clientWidth
    const centerX = activeDemoNode.x + 86
    const projected = centerX * viewport.zoom + viewport.x
    const zoom = Math.min(.9, right / 550)
    if (viewport.zoom >= zoom - .015 && projected > right * .13 && projected < right * .74) return
    void instance.setCenter(centerX + right * .17 / zoom, 108 + activeDemoNode.y / 2, { zoom, duration: 750 })
  }, [longDemo, followReady, activeDemoNode, playback.paused])

  function enterLongDemo() {
    followTouched.current = false
    setFollowReady(false)
    setScenario('critical')
    setLongStarted(mock)
    if (!mock) setSpeed(2)
    setTraining(undefined)
    setTrainingError('')
    setLongDemo(true)
    playback.restart()
  }

  async function startTraining() {
    if (mock) {
      setLongStarted(true)
      playback.restart()
      return
    }
    setTrainingBusy(true)
    setTrainingError('')
    try {
      const { id } = await postJson<{ id: string }>('/training/runs', { variant: scenario === 'critical' ? 'before' : 'fixed' })
      setTraining(await getJson<Run>(`/runs/${encodeURIComponent(id)}`))
      setLongStarted(true)
      playback.restart()
    } catch (reason) {
      setTrainingError(reason instanceof Error ? reason.message : 'Не удалось запустить учебную проверку.')
    } finally {
      setTrainingBusy(false)
    }
  }

  function leaveLongDemo() {
    setLongDemo(false)
    setLongStarted(false)
    playback.restart()
    requestAnimationFrame(() => { if (draftRef.current) fit(draftRef.current) })
  }

  function openDemo() {
    savedCamera.current = flow.current?.getViewport()
    cameraTouched.current = true
    playback.restart()
    setDemoStage(0)
    setDemoCompareRun(undefined)
    setDemoOpen(true)
  }

  function closeDemo() {
    setLongDemo(false)
    setLongStarted(false)
    setDemoOpen(false)
    if (savedCamera.current) void flow.current?.setViewport(savedCamera.current)
  }

  function focusEvidence(id: string) {
    const node = flow.current?.getNode(id)
    if (!node) return
    const zoom = flow.current?.getZoom()
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420
    void flow.current?.setCenter(node.position.x + (node.measured?.width ?? 172) / 2,
      node.position.y + (node.measured?.height ?? 62) / 2, { zoom, duration })
  }

  const markCameraTouched = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event) { cameraTouched.current = true; followTouched.current = true }
  }, [])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const resize = new ResizeObserver(() => {
      if (!cameraTouched.current && draftRef.current) fit(draftRef.current)
    })
    resize.observe(element)
    return () => resize.disconnect()
  }, [graphGeneration, fit])

  function order() {
    if (!workflow) return
    const next = orderGraph(workflow)
    setWorkflow(next)
    cameraTouched.current = true
    fit(next)
  }

  useEffect(() => {
    if (!ciRunId) return
    let active = true
    void getJson<Run>(`/runs/${encodeURIComponent(ciRunId)}`).then(run => {
      if (!active || run.workflowId !== workflowId) return
      setCiRun(run)
      setSelectedId(run.ci.nodeId ?? run.ci.gateNodeId ?? '')
    }).catch((error: unknown) => {
      if (active) setNotice({ text: error instanceof Error ? error.message : 'Не удалось загрузить решение CI.', error: true })
    })
    return () => { active = false }
  }, [ciRunId, workflowId])

  useEffect(() => {
    let active = true
    void Promise.all([
      workflowId ? getJson<Workflow>(`/workflows/${encodeURIComponent(workflowId)}`) : Promise.resolve(newWorkflow(!mock)),
      getJson<SnapshotRef[]>('/snapshots'),
      getJson<Workflow[]>('/workflows'),
    ]).then(([loaded, choices, saved]) => {
      if (!active) return
      cameraTouched.current = false
      setGraphGeneration(value => value + 1)
      setWorkflow(loaded)
      setSavedWorkflow(loaded)
      setSnapshots(choices)
      setSavedChoices(saved)
      setSnapshotId(loaded.snapshotId ?? '')
    }).catch((error: unknown) => {
      if (active) setNotice({ text: error instanceof Error ? error.message : 'Не удалось загрузить сценарий.', error: true })
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [workflowId, loadAttempt, mock])

  const commitPositions = useCallback((positions: Map<string, { x: number; y: number }>) => {
    setWorkflow(current => {
      if (!current) return current
      let changed = false
      const nextNodes = current.nodes.map(node => {
        const position = positions.get(node.id)
        if (!position || (node.x === position.x && node.y === position.y)) return node
        changed = true
        return { ...node, ...position }
      })
      return changed ? { ...current, nodes: nextNodes } : current
    })
  }, [])

  function addBlock(type: NodeType, drop?: Point, template?: Pick<Workflow['nodes'][number], 'name' | 'description' | 'settings'>) {
    const instance = flow.current
    const surface = canvas.current?.querySelector('.react-flow')
    if (!workflow || !instance || !surface || pending) return

    const rect = surface.getBoundingClientRect()
    const workspace = canvas.current?.parentElement
    const panel = inspector.current
    let right = Math.min(rect.right, window.innerWidth)
    if (panel && workspace) {
      const panelStyle = getComputedStyle(panel)
      const workspaceStyle = getComputedStyle(workspace)
      const panelWidth = Number.parseFloat(workspaceStyle.getPropertyValue('--inspector-width'))
      if (panelStyle.position === 'absolute') {
        right = Math.min(right, workspace.getBoundingClientRect().right - Math.min(panelWidth, workspace.clientWidth * .8) - 6)
      } else if (inspectorCollapsed && workspaceStyle.gridTemplateColumns.split(' ').length > 1) {
        right -= panelWidth + Number.parseFloat(workspaceStyle.columnGap)
      }
    }
    const left = Math.max(rect.left, 0)
    const top = Math.max(rect.top, 0)
    const bottom = Math.min(rect.bottom, window.innerHeight)
    if (right <= left || bottom <= top) return
    if (drop && (drop.x < rect.left || drop.x > rect.right || drop.y < rect.top || drop.y > rect.bottom)) return

    const fromScreen = (point: Point) => instance.screenToFlowPosition(point, { snapToGrid: false })
    const start = fromScreen({ x: left, y: top })
    const end = fromScreen({ x: right, y: bottom })
    const anchor = fromScreen(drop ?? { x: (left + right) / 2, y: (top + bottom) / 2 })
    const measured = new Map(instance.getNodes().map(node => [node.id, node.measured]))
    const position = placeNode(
      { ...start, width: end.x - start.x, height: end.y - start.y },
      workflow.nodes.map(node => ({
        x: node.x, y: node.y,
        width: measured.get(node.id)?.width ?? newNodeSize.width,
        height: measured.get(node.id)?.height ?? newNodeSize.height,
      })),
      anchor,
      newNodeSize,
      !drop,
    )

    const next = addNode(workflow, type, position)
    if (next === workflow) return
    cameraTouched.current = true
    const inserted = next.nodes[next.nodes.length - 1]
    setWorkflow(template ? { ...next, nodes: [...next.nodes.slice(0, -1), { ...inserted, ...template }] } : next)
    setSelectedId(next.nodes[next.nodes.length - 1].id)
    setSelectedEdge('')
    setInspectorCollapsed(false)
    setInspectorOpen(true)
    return true
  }

  function allowPaletteDrop(event: DragEvent<HTMLElement>) {
    if (pending || !event.dataTransfer.types.includes(paletteMime)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function dropBlock(event: DragEvent<HTMLElement>) {
    const type = nodeTypes.find(value => value === event.dataTransfer.getData(paletteMime))
    if (!type) return
    event.preventDefault()
    addBlock(type, { x: event.clientX, y: event.clientY })
  }

  const linkBlocks = useCallback(({ source, target, sourceHandle }: Connection) => {
    const branch = sourceHandle === 'yes' || sourceHandle === 'no' ? sourceHandle : 'next'
    setWorkflow(current => current && connect(current, { from: source, to: target, branch }))
  }, [])
  const pickNode = useCallback((id: string) => {
    setSelectedId(id)
    setSelectedEdge('')
    setInspectorCollapsed(false)
    setInspectorOpen(true)
  }, [])
  const pickEdge = useCallback((id: string) => {
    setSelectedEdge(id)
    setSelectedId('')
  }, [])
  const clearSelection = useCallback(() => {
    setSelectedId('')
    setSelectedEdge('')
    setInspectorOpen(false)
  }, [])

  async function submit(action: 'save' | 'run') {
    if (!workflow || pending) return
    if (action === 'save') setSaving(true)
    setNotice(undefined)
    try {
      let targetId = workflow.id
      if (action === 'save' || dirty) {
        setSaving(true)
        const saved = await saveDraft({ ...workflow, snapshotId: snapshotId || undefined })
        targetId = saved.id
        if (!workflow.id) {
          const url = new URL(window.location.href)
          url.searchParams.set('workflow', saved.id)
          window.history.replaceState(null, '', url)
        }
        setWorkflow(saved)
        setSavedWorkflow(saved)
        setSavedChoices(items => [...items.filter(item => item.id !== saved.id), saved])
        setNotice({ text: `Сохранено · ревизия ${saved.revision}` })
      }
      if (action === 'run' && targetId) {
        playback.restart()
        await start(targetId, { trigger: 'manual', snapshotId })
      }
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Не удалось выполнить запрос.', error: true })
    } finally {
      setSaving(false)
    }
  }

  const completedNode = playback.completedNode
  const nodes = useMemo<Block[]>(() => (displayedWorkflow?.nodes ?? []).map(node => ({
    id: node.id, type: 'workflow', zIndex: 2, position: { x: node.x, y: node.y },
    data: { reconstructed: reconstructed?.reconstructed?.has(node.id), kind: node.type, detail: node.name || (longDemo && mock ? demoDetails.get(node.id) : node.type === 'condition' ? conditionLabel(node.settings) : undefined), status: visualRun?.nodes[node.id]?.status,
      activation: activation && playbackView?.nodes[node.id]?.status === 'running'
        ? { ...activation, phase: 'running' } : activation && node.id === completedNode
          ? { ...activation, phase: 'succeeded' } : undefined,
      arrival: playback.edge?.to === node.id,
      branch: branchOf(visualRun?.nodes[node.id]?.output) ?? visualRun?.nodes[node.id]?.branch,
      critical: node.id === pulseNode && node.id === criticalNode && Boolean(criticalFinding) && visualRun?.nodes[node.id]?.status === 'succeeded',
      highlighted: highlight?.nodeIds.includes(node.id),
      ciPassed: highlightRun?.ci.status === 'passed',
      muted: Boolean(explanationRun && highlight?.nodeIds.length && !highlight.nodeIds.includes(node.id)) }, selected: node.id === selectedId,
  })), [displayedWorkflow?.nodes, longDemo, mock, reconstructed, visualRun, highlight, selectedId, explanationRun, highlightRun, pulseNode, playbackView, activation, completedNode, playback.edge, criticalNode, criticalFinding])
  const edges = useMemo(() => (displayedWorkflow?.edges ?? []).map(edge => {
    const highlighted = highlight?.edge?.from === edge.from && highlight.edge.branch === edge.branch
    const id = `${edge.from}:${edge.branch}`
    const related = selectedEdge === id || (selectedId !== '' && (edge.from === selectedId || edge.to === selectedId))
    const choice = branchChoice(edge, visualRun)
    const pulse = playback.edge?.from === edge.from && playback.edge.branch === edge.branch && playback.edge.to === edge.to
    const color = choice === 'taken' ? '#72e3ac' : highlighted ? highlightRun?.ci.status === 'passed' ? '#72e3ac' : '#f1747b' : related ? '#72e3ac' : edge.branch === 'yes' ? '#80a993' : edge.branch === 'no' ? '#be9e6b' : '#71868f'
    return {
      id, source: edge.from, target: edge.to, sourceHandle: edge.branch, type: 'workflow', interactionWidth: 8, zIndex: 0,
      selected: id === selectedEdge,
      data: { pulse },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: highlighted || related || choice === 'taken' ? 2.6 : 1.6, opacity: choice === 'alternate' ? .32 : undefined },
      className: highlighted ? 'garden-ci-edge' : related ? 'garden-related-edge' : undefined,
    }
  }), [displayedWorkflow?.edges, highlight, selectedId, selectedEdge, visualRun, highlightRun, playback.edge])

  return (
    <div className="garden-shell" data-replay-open={demoOpen}>
      <WorkspaceNav workflowId={workflow?.id ?? workflowId} section="editor" />
      <main className="garden">
      <section className="garden-heading garden-editor-heading">
        <div className="garden-heading-text">
          <p className="garden-kicker">Сценарии <span>/</span> Конструктор</p>
          <h1>{workflow?.name ?? 'Редактор сценариев'}</h1>
          {workflow && <div className="garden-workflow-meta"><code>{workflow.id ?? 'Черновик'}{workflow.id && ` / r${workflow.revision}`}</code>
            <span className="garden-save-state" data-dirty={Boolean(dirty)}>{saving ? 'Сохранение…' : dirty ? 'Есть изменения' : 'Сохранено'}</span>
          </div>}
        </div>
        <div className="garden-actions">
          <button type="button" disabled={pending} onClick={openDemo}>Режим демонстрации</button>
          {workflow && <>
            <button disabled={pending || demoOpen || Boolean(recordedGraph)} onClick={() => void submit('save')}>Сохранить</button>
            <button className="garden-primary" disabled={pending || demoOpen || Boolean(recordedGraph) || !snapshotId} onClick={() => void submit('run')}>▷ Запустить</button>
          </>}
        </div>
      </section>
      {workflow && <div className="garden-toolbar">
        <div className="garden-toolbar-group"><a href="?workflow=new"><Icon name="plus" size={15} />Новый сценарий</a>
          {savedChoices.length > 0 && <select aria-label="Открыть сохранённый сценарий" value={workflow.id ?? ''}
            onChange={event => { if (event.target.value) window.location.search = new URLSearchParams({ workflow: event.target.value }).toString() }}>
            <option value="">Сохранённые сценарии</option>
            {savedChoices.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>}
          <NodeCatalog disabled={pending || demoOpen || Boolean(recordedGraph)} onInsert={({ type, name, description, settings }) =>
            Boolean(addBlock(type, undefined, { name, description, settings }))} />
          <DraftDialog disabled={pending} onOpenDraft={({ warnings, ...draft }) => {
            cameraTouched.current = false
            setGraphGeneration(value => value + 1)
            setWorkflow(draft)
            setDraftWarnings(warnings ?? [])
            clearAccepted()
            setSnapshotId(draft.snapshotId ?? '')
            setSelectedId('')
            setCiRun(undefined)
            setNotice(undefined)
            const url = new URL(window.location.href)
            url.search = new URLSearchParams({ workflow: 'new' }).toString()
            window.history.replaceState(null, '', url)
          }} />
          {workflow.id && <details className="garden-ci-download"><summary>GitHub Actions</summary>
            <div className="garden-integration-actions">
              <a href={apiUrl(`/workflows/${encodeURIComponent(workflow.id)}/github-actions`)} download>Скачать YAML</a>
              <a href={apiUrl('/ci/client')} download>Скачать клиент</a>
            </div>
          </details>}
</div>
                  <SnapshotPicker snapshots={snapshots} value={snapshotId} disabled={pending} onSelect={setSnapshotId}
            onImport={snapshot => setSnapshots(current => [...current.filter(item => item.id !== snapshot.id), snapshot])} />

      </div>}
      <AdvisoryPanel />
      {draftWarnings.length > 0 && <section className="garden-notice garden-draft-notice" aria-label="Предупреждения черновика">
        <ul>{draftWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        {missingChannel && <button type="button" onClick={() => { setSelectedId(missingChannel.id); setInspectorCollapsed(false); setInspectorOpen(true) }}>Настроить Telegram</button>}
      </section>}
      {copiedTemplate && workflow && <section className="garden-notice garden-copy-setup" aria-label="Настройка копии">
        <strong>Настройте свою копию</strong>
        {!snapshotId && <span>Выберите снимок проекта.</span>}
        {missingChannel && <button type="button" onClick={() => { setSelectedId(missingChannel.id); setInspectorCollapsed(false); setInspectorOpen(true) }}>
          Выбрать канал Telegram
        </button>}
        {snapshotId && !missingChannel && <span>Сохраните выбранные настройки.</span>}
      </section>}
      {ciRun && highlight && <p className="garden-notice">
        <a href={runsUrl(ciRun.workflowId, ciRun.id)}>{ciRun.id}</a> · CI {ciRun.ci.status}
        {highlight.findingId && ` · ${highlight.findingId}`}
        {!explanationOpen && <button onClick={() => setExplanationOpen(true)}>{ciRun.ci.status === 'failed' ? 'Почему CI не пройден?' : 'Объяснение CI'}</button>}
      </p>}
      {notice && <p className={`garden-notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      {accepted && workflow?.id && <section className="garden-run-accepted" aria-label="Текущий запуск">
        <a href={runsUrl(workflow.id, accepted.id)}>{accepted.id}</a> <span role="status" data-run-status={runStatus}>{{
          queued: 'Запуск поставлен в очередь', running: 'Проверка выполняется', succeeded: 'Проверка завершена', failed: 'Проверка завершилась ошибкой',
        }[runStatus ?? 'queued']}</span>
        {runView?.ciStatus && <span className={visualFinished ? 'pulse-ci-result' : undefined} data-ci-status={runView.ciStatus}>CI {runView.ciStatus.toUpperCase()}</span>}
        {(playback.playing || visualFinished) && <small data-visual-status={visualFinished ? 'finished' : playback.paused ? 'paused' : 'playing'}>
          {visualFinished ? 'Визуализация завершена' : playback.paused ? 'Визуализация на паузе' : 'Воспроизводится анимация'}
        </small>}
        {criticalFinding && <a href={runsUrl(workflow.id, accepted.id)}>Находка {criticalFinding}</a>}
        <PlaybackControls playback={playback} speed={speed} onSpeed={setSpeed} />
      </section>}
      {loading && <p className="garden-notice" role="status">Загрузка сценария…</p>}
      {!loading && !workflow && <button className="garden-retry" onClick={() => { setLoading(true); setNotice(undefined); setLoadAttempt(attempt => attempt + 1) }}>Повторить</button>}
      {demoOpen && (longDemo ? <LongDemoPanel scenario={scenario} started={longStarted} graph={training?.graph}
        busy={trainingBusy} error={trainingError} onScenario={next => {
        if (next === scenario) return
        setScenario(next)
        setLongStarted(false)
        setTraining(undefined)
        setTrainingError('')
        playback.restart()
      }} onStart={() => void startTraining()} onBack={leaveLongDemo} onClose={closeDemo}
        playback={playback} onSpeed={setSpeed} activeLabel={activeLabel} /> : <PresentationMode stage={demoStage} setStage={stage => {
        setDemoStage(stage)
        setDemoCompareRun(undefined)
        if (stage === 0) playback.restart()
      }} onClose={closeDemo} run={demo.run} error={demo.error} playback={playback} speed={speed} onSpeed={setSpeed}
        activeLabel={activeLabel} onFocus={focusEvidence} replayId={demo.id ?? ''} choices={demo.choices ?? (!workflow?.id ? [] : undefined)}
        onReplayId={id => { setReplayId(id); playback.restart() }}
        onCompare={setDemoCompareRun} onLongDemo={enterLongDemo} />)}
      {displayedWorkflow && <div className="garden-workspace" data-inspector-collapsed={inspectorCollapsed} data-explain-open={!demoOpen && Boolean(explanationRun)}>
        <aside className="garden-panel garden-palette" aria-label="Палитра">
          <h2>Палитра блоков</h2>
          {palette.map(group => <section key={group.title}><h3>{group.title}</h3>
            {group.types.map(type => {
              const disabled = pending || (type === 'start' && hasStart)
              return <button key={type} data-block-type={type} data-node-tone={labels[type][2]} disabled={disabled}
                title={type === 'start' && hasStart ? 'В сценарии уже есть блок «Запуск»' : undefined}
                draggable={!disabled} onDragStart={event => {
                  if (disabled) { event.preventDefault(); return }
                  event.dataTransfer.effectAllowed = 'copy'
                  event.dataTransfer.setData(paletteMime, type)
                }} onClick={() => addBlock(type)}>
                <span className="garden-icon"><Icon name={type} size={16} /></span>{labels[type][0]}
              </button>
            })}
          </section>)}
        </aside>
        <section ref={canvas} className="garden-canvas" aria-label="Граф сценария" onDragOver={demoOpen ? undefined : allowPaletteDrop} onDrop={demoOpen ? undefined : dropBlock}>
          <div className="garden-canvas-header"><div><Icon name="graph" size={16} /><strong>{longDemo ? "Учебный граф" : "Граф сценария"}</strong></div>
            <button className="garden-inspector-toggle" onClick={() => { setInspectorCollapsed(false); setInspectorOpen(open => !open) }} aria-expanded={inspectorOpen} aria-controls="workflow-inspector"><Icon name="panel" size={16} />Настройки</button>
          </div>
          <FlowCanvas nodes={nodes} edges={edges} overview={longDemo} pending={pending || demoOpen || Boolean(recordedGraph)} onInit={initializeFlow} onMoveStart={markCameraTouched}
            onPositionCommit={commitPositions} onConnect={linkBlocks} onPickNode={pickNode}
            onPickEdge={pickEdge} onClearSelection={clearSelection} />
          <button className="garden-layout" type="button" disabled={pending} onClick={order}><Icon name="layout" size={15} />Упорядочить</button>
        </section>
        {!longDemo && workflow && (!demoOpen && explanationRun
          ? <aside className="replay-inspector"><ExplainableCI key={explanationRun.id} run={explanationRun} initialStep={0}
            analyzerType={displayedWorkflow.nodes.find(node => node.id === explanationRun.ci.nodeId)?.type}
            onClose={() => setExplanationOpen(false)} onFocus={focusEvidence} /></aside>
          : <aside ref={inspector} className="garden-panel garden-settings" id="workflow-inspector" data-open={inspectorOpen} aria-label="Настройки блока">
          <div className="garden-inspector-title"><h2>Настройки</h2><button className="garden-inspector-close" onClick={() => { setInspectorOpen(false); setInspectorCollapsed(true) }} aria-label="Закрыть настройки">×</button></div>
          {activeNode ? <>
            <div className="garden-inspector-node" data-node-tone={labels[activeNode.type][2]}>
              <span className="garden-icon"><Icon name={activeNode.type} /></span><div><h3>{activeNode.name || labels[activeNode.type][0]}</h3><code>{activeNode.id}</code></div>
            </div>
            <p>{activeNode.description || labels[activeNode.type][1]}</p>
            {activeNode.type === 'condition' && <div className="garden-branch-summary">
              {(['yes', 'no'] as const).map(branch => {
                const target = workflow.nodes.find(node => node.id === workflow.edges.find(edge => edge.from === activeNode.id && edge.branch === branch)?.to)
                return <p key={branch}><code>{branch.toUpperCase()}</code> {target ? labels[target.type][0] : 'Нет связи'}</p>
              })}
            </div>}
            <NodeSettings node={activeNode} schedule={workflow.schedule} disabled={pending || demoOpen || Boolean(recordedGraph)}
              onSettingsChange={settings => setWorkflow(current => current && ({
                ...current, nodes: current.nodes.map(node => node.id === activeNode.id ? { ...node, settings } : node),
              }))}
              onScheduleChange={schedule => setWorkflow(current => current && ({ ...current, schedule }))} />
            <dl><dt>Входы</dt><dd>{workflow.edges.filter(edge => edge.to === activeNode.id).length}</dd>
              <dt>Выходы</dt><dd>{workflow.edges.filter(edge => edge.from === activeNode.id).length}</dd><dt>X</dt><dd>{Math.round(activeNode.x)}</dd><dt>Y</dt><dd>{Math.round(activeNode.y)}</dd></dl>
            {activeNodeView && <div className="garden-node-output">
              <h3>Данные запуска</h3>
              <p>{statuses[activeNodeView.status]}</p>
              {activeNodeView.input !== undefined && <><h4>Вход</h4><pre>{JSON.stringify(activeNodeView.input, null, 2)}</pre></>}
              {activeNodeView.output !== undefined && <><h4>Выход</h4><pre>{JSON.stringify(activeNodeView.output, null, 2)}</pre></>}
              {activeNodeView.error && <p>{activeNodeView.error.message}</p>}
            </div>}
            <button className="garden-remove" disabled={pending || demoOpen || Boolean(recordedGraph)} onClick={() => {
              setWorkflow(current => current && removeNode(current, selectedId))
              setSelectedId('')
            }}>Удалить блок</button>
          </> : <div className="garden-inspector-empty">
            <span className="garden-icon"><Icon name="panel" /></span>
            <h3>Выберите блок</h3><p>Нажмите на блок на холсте, чтобы открыть его настройки и посмотреть связи.</p>
            <dl><dt>Блоки</dt><dd>{workflow.nodes.length}</dd><dt>Связи</dt><dd>{workflow.edges.length}</dd></dl>
          </div>}
        </aside>)}
      </div>}
      </main>
    </div>
  )
}
