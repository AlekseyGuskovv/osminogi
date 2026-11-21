import { Background, BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, getSmoothStepPath, useNodesState } from '@xyflow/react'
import type { Connection, Edge, EdgeProps, Node, NodeChangeset, NodeProps, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { DragEvent } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getJson } from '../api'
import type { SnapshotRef } from '../api'
import { getHighlight } from '../runs/ci'
import type { Run } from '../runs/types'
import { runsUrl } from '../runs/navigation'
import { useRunStatus, useStartRun } from '../runs/useRun'
import { nodeTypes } from '../workflow'
import type { NodeType, Workflow } from '../workflow'
import { newWorkflow, saveDraft } from './useWorkflow'
import type { EditableWorkflow } from './useWorkflow'
import { SnapshotPicker } from './SnapshotPicker'
import { DraftDialog } from './DraftDialog'
import { NodeSettings } from './NodeSettings'
import { addNode, connect, removeNode } from './graph'
import '@xyflow/react/dist/style.css'
import { Icon } from '../ui/Icon'
import { WorkspaceNav } from '../ui/WorkspaceNav'
import { orderGraph } from './layout'
import { newNodeSize, placeNode } from './placement'
import type { Point } from './graph'

const paletteMime = 'application/x-cyber-garden-node'

const labels = {
  start: ['Запуск', 'Начало сценария', 'terminal'],
  secrets: ['Поиск секретов', 'Токены и ключи', 'analysis'],
  sca: ['Зависимости', 'Состав проекта', 'analysis'],
  sast: ['Анализ кода', 'Статический анализ', 'analysis'],
  ai: ['Рекомендации AI', 'Приоритизация рисков', 'ai'],
  condition: ['Условие', 'Развилка сценария', 'decision'],
  telegram: ['Telegram', 'Доставка отчёта', 'delivery'],
  finish: ['Завершение', 'Конец сценария', 'terminal'],
} as const

const palette = [
  { title: 'Поток', types: ['start', 'condition', 'finish'] },
  { title: 'Анализ', types: ['secrets', 'sca', 'sast'] },
  { title: 'Обработка', types: ['ai', 'telegram'] },
] as const

const severity = { critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий' }

function conditionLabel(settings: Record<string, unknown>) {
  if (settings.metric === 'findingCount') return `Находок ≥ ${String(settings.value ?? 1)}`
  if (settings.metric === 'findingTitle') return settings.value ? 'Совпадение по названию' : 'Шаблон не задан'
  const value = String(settings.value ?? 'critical')
  return `Риск ≥ ${severity[value as keyof typeof severity] ?? value}`
}

function fittedViewport(workflow: EditableWorkflow, width: number, height: number): Viewport {
  if (!workflow.nodes.length || width < 100 || height < 100) return { x: 0, y: 0, zoom: 1 }
  const left = Math.min(...workflow.nodes.map(node => node.x))
  const top = Math.min(...workflow.nodes.map(node => node.y))
  const graphWidth = Math.max(...workflow.nodes.map(node => node.x)) + 172 - left
  const graphHeight = Math.max(...workflow.nodes.map(node => node.y)) + 85 - top
  const zoom = Math.max(.2, Math.min(1.22, (width - 76) / graphWidth, (height - 76) / graphHeight))
  return {
    x: (width - graphWidth * zoom) / 2 - left * zoom,
    y: (height - graphHeight * zoom) / 2 - top * zoom,
    zoom,
  }
}

const statuses = { queued: 'В очереди', running: 'Выполняется', succeeded: 'Готово', failed: 'Ошибка', skipped: 'Пропущен' }
type Block = Node<{ kind: NodeType; detail?: string; status?: keyof typeof statuses; highlighted?: boolean }, 'workflow'>
export type EditorProps = { workflowId?: string; ciRunId?: string; copiedTemplate?: boolean }

const WorkflowBlock = memo(function WorkflowBlock({ data, selected }: NodeProps<Block>) {
  const { kind } = data
  const [label, description, tone] = labels[kind]
  return (
    <div className={`garden-node ${selected ? 'selected' : ''}`} data-node-tone={tone} data-ci-highlight={data.highlighted || undefined}>
      {kind !== 'start' && <Handle type="target" position={Position.Left} aria-label="Вход" />}
      <span className="garden-icon"><Icon name={kind} size={17} /></span>
      <span className="garden-node-copy"><strong>{label}</strong><span>{data.detail ?? description}</span>
        {data.status && <small data-node-status={data.status}>{statuses[data.status]}</small>}
      </span>
      {kind === 'condition' ? <>
        <span className="garden-port yes" aria-hidden="true">YES</span>
        <span className="garden-port no" aria-hidden="true">NO</span>
        <Handle type="source" id="yes" position={Position.Right} style={{ top: '28%' }} aria-label="Выход YES" />
        <Handle type="source" id="no" position={Position.Right} style={{ top: '76%' }} aria-label="Выход NO" />
      </> : kind !== 'finish' && <Handle type="source" id="next" position={Position.Right} aria-label="Выход" />}
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
  return <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd}
    interactionWidth={props.interactionWidth} />
}

const flowEdgeTypes = { workflow: WorkflowEdge }


type FlowCanvasProps = {
  nodes: Block[]
  edges: Edge[]
  pending: boolean
  onInit: (instance: ReactFlowInstance<Block>) => void
  onMoveStart: (event: MouseEvent | TouchEvent | null) => void
  onPositionCommit: (positions: Map<string, { x: number; y: number }>) => void
  onConnect: (connection: Connection) => void
  onPickNode: (id: string) => void
  onPickEdge: (id: string) => void
  onClearSelection: () => void
}

const FlowCanvas = memo(function FlowCanvas({
  nodes, edges, pending, onInit, onMoveStart, onPositionCommit, onConnect, onPickNode, onPickEdge, onClearSelection,
}: FlowCanvasProps) {
  const [localNodes, setLocalNodes] = useNodesState(nodes)
  useEffect(() => {
    setLocalNodes(current => {
      const existing = new Map(current.map(node => [node.id, node]))
      return nodes.map(node => {
        const previous = existing.get(node.id)
        // Dropping measured dimensions invalidates React Flow's cached handle bounds.
        return previous?.measured ? { ...node, measured: previous.measured } : node
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
    className="dark" minZoom={.2} maxZoom={2} zIndexMode="manual"
    nodesDraggable={!pending} nodesConnectable={!pending} deleteKeyCode={null}
    onInit={onInit} onMoveStart={onMoveStart} onNodesChange={changeNodes} onConnect={onConnect}
    onNodeClick={(_, node) => onPickNode(node.id)} onEdgeClick={(_, edge) => onPickEdge(edge.id)}
    onPaneClick={onClearSelection}>
    <Background color="#33464e" gap={24} size={1.2} />
    <Controls showInteractive={false} />
  </ReactFlow>
})

export function WorkflowEditor({ workflowId, ciRunId, copiedTemplate }: EditorProps) {
  const [workflow, setWorkflow] = useState<EditableWorkflow>()
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
  const [snapshots, setSnapshots] = useState<SnapshotRef[]>([])
  const [draftWarnings, setDraftWarnings] = useState<string[]>([])
  const [snapshotId, setSnapshotId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const { start, starting, accepted, clearAccepted } = useStartRun()
  const pending = saving || starting
  const runView = useRunStatus(accepted?.id)
  const runStatus = runView?.status ?? accepted?.status
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
  const dirty = workflow && (!workflow.id || JSON.stringify({ ...workflow, snapshotId: snapshotId || undefined }) !== JSON.stringify(savedWorkflow))
  const hasStart = workflow?.nodes.some(node => node.type === 'start')
  const activeNode = workflow?.nodes.find(node => node.id === selectedId)
  const activeNodeView = runView?.nodes[selectedId]
  const missingChannel = workflow?.nodes.find(node => node.type === 'telegram' && !node.settings.channelId)
  const highlight = useMemo(
    () => ciRun?.workflowId === workflowId && ciRun ? getHighlight(ciRun.ci) : undefined,
    [ciRun, workflowId],
  )

  useEffect(() => { draftRef.current = workflow }, [workflow])
  const fit = useCallback((draft: EditableWorkflow) => {
    const element = canvas.current
    if (!element) return
    const header = element.querySelector<HTMLElement>('.garden-canvas-header')
    void flow.current?.setViewport(fittedViewport(draft, element.clientWidth, element.clientHeight - (header?.offsetHeight ?? 0)))
  }, [])

  const initializeFlow = useCallback((instance: ReactFlowInstance<Block>) => {
    flow.current = instance
    if (draftRef.current && !cameraTouched.current) fit(draftRef.current)
  }, [fit])

  const markCameraTouched = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event) cameraTouched.current = true
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
      workflowId ? getJson<Workflow>(`/workflows/${encodeURIComponent(workflowId)}`) : Promise.resolve(newWorkflow()),
      getJson<SnapshotRef[]>('/snapshots'),
    ]).then(([loaded, choices]) => {
      if (!active) return
      cameraTouched.current = false
      setGraphGeneration(value => value + 1)
      setWorkflow(loaded)
      setSavedWorkflow(loaded)
      setSnapshots(choices)
      setSnapshotId(loaded.snapshotId ?? '')
    }).catch((error: unknown) => {
      if (active) setNotice({ text: error instanceof Error ? error.message : 'Не удалось загрузить сценарий.', error: true })
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [workflowId, loadAttempt])

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

  function addBlock(type: NodeType, drop?: Point) {
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
    setWorkflow(next)
    setSelectedId(next.nodes[next.nodes.length - 1].id)
    setSelectedEdge('')
    setInspectorCollapsed(false)
    setInspectorOpen(true)
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
      if (action === 'save') {
        const saved = await saveDraft({ ...workflow, snapshotId: snapshotId || undefined })
        if (!workflow.id) {
          const url = new URL(window.location.href)
          url.searchParams.set('workflow', saved.id)
          window.history.replaceState(null, '', url)
        }
        setWorkflow(saved)
        setSavedWorkflow(saved)
        setNotice({ text: `Сохранено · ревизия ${saved.revision}` })
      } else if (workflow.id) {
        const run = await start(workflow.id, { trigger: 'manual', snapshotId })
        if (run) setNotice({ text: `${run.id} поставлен в очередь` })
      }
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Не удалось выполнить запрос.', error: true })
    } finally {
      if (action === 'save') setSaving(false)
    }
  }

  const nodes = useMemo<Block[]>(() => (workflow?.nodes ?? []).map(node => ({
    id: node.id, type: 'workflow', zIndex: 2, position: { x: node.x, y: node.y },
    data: { kind: node.type, detail: node.type === 'condition' ? conditionLabel(node.settings) : undefined, status: runView?.nodes[node.id]?.status, highlighted: highlight?.nodeIds.includes(node.id) }, selected: node.id === selectedId,
  })), [workflow?.nodes, runView, highlight, selectedId])
  const edges = useMemo(() => (workflow?.edges ?? []).map(edge => {
    const highlighted = highlight?.edge?.from === edge.from && highlight.edge.branch === edge.branch
    const id = `${edge.from}:${edge.branch}`
    const related = selectedEdge === id || (selectedId !== '' && (edge.from === selectedId || edge.to === selectedId))
    const color = highlighted ? '#f1747b' : related ? '#72e3ac' : edge.branch === 'yes' ? '#80a993' : edge.branch === 'no' ? '#be9e6b' : '#71868f'
    return {
      id, source: edge.from, target: edge.to, sourceHandle: edge.branch, type: 'workflow', interactionWidth: 8, zIndex: 0,
      selected: id === selectedEdge,
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: highlighted || related ? 2.6 : 1.6 },
      className: highlighted ? 'garden-ci-edge' : related ? 'garden-related-edge' : undefined,
    }
  }), [workflow?.edges, highlight, selectedId, selectedEdge])

  return (
    <div className="garden-shell">
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
        {workflow && <div className="garden-actions">
          <button disabled={pending} onClick={() => void submit('save')}>Сохранить</button>
          <button className="garden-primary" disabled={pending || !workflow.id || !snapshotId} onClick={() => void submit('run')}>▷ Запустить</button>
        </div>}
      </section>
      {workflow && <div className="garden-toolbar">
        <div className="garden-toolbar-group"><a href="?workflow=new"><Icon name="plus" size={15} />Новый сценарий</a>
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
</div>
                  <SnapshotPicker snapshots={snapshots} value={snapshotId} disabled={pending} onSelect={setSnapshotId}
            onImport={snapshot => setSnapshots(current => [...current.filter(item => item.id !== snapshot.id), snapshot])} />

      </div>}
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
      </p>}
      {notice && <p className={`garden-notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      {accepted && workflow?.id && <section className="garden-run-accepted" aria-label="Текущий запуск">
        <a href={runsUrl(workflow.id, accepted.id)}>{accepted.id}</a> <span data-run-status={runStatus}>{{
          queued: 'В очереди', running: 'Выполняется', succeeded: 'Проверка завершена', failed: 'Проверка завершилась ошибкой',
        }[runStatus ?? 'queued']}</span>
        {runView?.ciStatus && <span data-ci-status={runView.ciStatus}>CI · {runView.ciStatus}</span>}
      </section>}
      {loading && <p className="garden-notice" role="status">Загрузка сценария…</p>}
      {!loading && !workflow && <button className="garden-retry" onClick={() => { setLoading(true); setNotice(undefined); setLoadAttempt(attempt => attempt + 1) }}>Повторить</button>}
      {workflow && <div className="garden-workspace" data-inspector-collapsed={inspectorCollapsed}>
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
        <section ref={canvas} className="garden-canvas" aria-label="Граф сценария" onDragOver={allowPaletteDrop} onDrop={dropBlock}>
          <div className="garden-canvas-header"><div><Icon name="graph" size={16} /><strong>Граф сценария</strong></div>
            <button className="garden-inspector-toggle" onClick={() => { setInspectorCollapsed(false); setInspectorOpen(open => !open) }} aria-expanded={inspectorOpen} aria-controls="workflow-inspector"><Icon name="panel" size={16} />Настройки</button>
          </div>
          <FlowCanvas nodes={nodes} edges={edges} pending={pending} onInit={initializeFlow} onMoveStart={markCameraTouched}
            onPositionCommit={commitPositions} onConnect={linkBlocks} onPickNode={pickNode}
            onPickEdge={pickEdge} onClearSelection={clearSelection} />
          <button className="garden-layout" type="button" disabled={pending} onClick={order}><Icon name="layout" size={15} />Упорядочить</button>
        </section>
        <aside ref={inspector} className="garden-panel garden-settings" id="workflow-inspector" data-open={inspectorOpen} aria-label="Настройки блока">
          <div className="garden-inspector-title"><h2>Настройки</h2><button className="garden-inspector-close" onClick={() => { setInspectorOpen(false); setInspectorCollapsed(true) }} aria-label="Закрыть настройки">×</button></div>
          {activeNode ? <>
            <div className="garden-inspector-node" data-node-tone={labels[activeNode.type][2]}>
              <span className="garden-icon"><Icon name={activeNode.type} /></span><div><h3>{labels[activeNode.type][0]}</h3><code>{activeNode.id}</code></div>
            </div>
            <p>{labels[activeNode.type][1]}</p>
            {activeNode.type === 'condition' && <div className="garden-branch-summary">
              {(['yes', 'no'] as const).map(branch => {
                const target = workflow.nodes.find(node => node.id === workflow.edges.find(edge => edge.from === activeNode.id && edge.branch === branch)?.to)
                return <p key={branch}><code>{branch.toUpperCase()}</code> {target ? labels[target.type][0] : 'Нет связи'}</p>
              })}
            </div>}
            <NodeSettings node={activeNode} schedule={workflow.schedule} disabled={pending}
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
            <button className="garden-remove" disabled={pending} onClick={() => {
              setWorkflow(current => current && removeNode(current, selectedId))
              setSelectedId('')
            }}>Удалить блок</button>
          </> : <div className="garden-inspector-empty">
            <span className="garden-icon"><Icon name="panel" /></span>
            <h3>Выберите блок</h3><p>Нажмите на блок на холсте, чтобы открыть его настройки и посмотреть связи.</p>
            <dl><dt>Блоки</dt><dd>{workflow.nodes.length}</dd><dt>Связи</dt><dd>{workflow.edges.length}</dd></dl>
          </div>}
        </aside>
      </div>}
      </main>
    </div>
  )
}
