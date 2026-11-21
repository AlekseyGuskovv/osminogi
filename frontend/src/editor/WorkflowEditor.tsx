import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react'
import type { Connection, Node, NodeChangeset, NodeProps } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { getJson } from '../api'
import { getHighlight } from '../runs/ci'
import type { Run } from '../runs/types'
import { runsUrl } from '../runs/navigation'
import { useRunStatus, useStartRun } from '../runs/useRun'
import { nodeTypes } from '../workflow'
import type { NodeType, Workflow } from '../workflow'
import { newWorkflow, saveDraft } from './useWorkflow'
import type { EditableWorkflow } from './useWorkflow'
import { NodeSettings } from './NodeSettings'
import { addNode, connect, removeNode } from './graph'
import '@xyflow/react/dist/style.css'
import './editor.css'

const labels: Record<NodeType, [string, string]> = {
  start: ['Запуск', '▷'],
  secrets: ['Поиск секретов', '◇'],
  sca: ['Зависимости', '▤'],
  sast: ['Анализ кода', '⌘'],
  ai: ['Рекомендации AI', '✧'],
  condition: ['Условие', '⑂'],
  telegram: ['Telegram', '↗'],
  finish: ['Завершение', '✓'],
}

const statuses = { queued: 'В очереди', running: 'Выполняется', succeeded: 'Готово', failed: 'Ошибка', skipped: 'Пропущен' }
type Block = Node<{ kind: NodeType; status?: keyof typeof statuses; highlighted?: boolean }, 'workflow'>
type Snapshot = { id: string; label: string }
export type EditorProps = { workflowId?: string; ciRunId?: string }

function WorkflowBlock({ data, selected }: NodeProps<Block>) {
  const { kind } = data
  const [label, icon] = labels[kind]
  return (
    <div className={`garden-node ${selected ? 'selected' : ''}`} data-ci-highlight={data.highlighted || undefined}>
      {kind !== 'start' && <Handle type="target" position={Position.Left} />}
      <span className="garden-icon" aria-hidden="true">{icon}</span>
      <span>{label}{data.status && <small data-node-status={data.status}>{statuses[data.status]}</small>}</span>
      {kind === 'condition' ? <>
        <Handle type="source" id="yes" position={Position.Right} style={{ top: '32%' }} />
        <Handle type="source" id="no" position={Position.Right} style={{ top: '72%' }} />
      </> : kind !== 'finish' && <Handle type="source" id="next" position={Position.Right} />}
    </div>
  )
}

const flowNodeTypes = { workflow: WorkflowBlock }

export function WorkflowEditor({ workflowId, ciRunId }: EditorProps) {
  const [workflow, setWorkflow] = useState<EditableWorkflow>()
  const [ciRun, setCiRun] = useState<Run>()
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [snapshotId, setSnapshotId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const { start, starting, accepted } = useStartRun()
  const pending = saving || starting
  const runView = useRunStatus(accepted?.id)
  const runStatus = runView?.status ?? accepted?.status
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
  const activeNode = workflow?.nodes.find(node => node.id === selectedId)
  const activeNodeView = runView?.nodes[selectedId]
  const highlight = ciRun?.workflowId === workflowId && ciRun ? getHighlight(ciRun.ci) : undefined

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
      getJson<Snapshot[]>('/snapshots'),
    ]).then(([loaded, choices]) => {
      if (!active) return
      setWorkflow(loaded)
      setSnapshots(choices)
      setSnapshotId(loaded.snapshotId ?? '')
    }).catch((error: unknown) => {
      if (active) setNotice({ text: error instanceof Error ? error.message : 'Не удалось загрузить сценарий.', error: true })
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [workflowId, loadAttempt])

  function moveNodes(changes: NodeChangeset<Block>) {
    const positions = new Map(changes.getByType('position').flatMap(change =>
      change.position ? [[change.id, change.position] as const] : [],
    ))
    if (!positions.size) return
    setWorkflow(current => current && ({
      ...current,
      nodes: current.nodes.map(node => ({ ...node, ...positions.get(node.id) })),
    }))
  }

  function addBlock(type: NodeType) {
    if (!workflow) return
    const next = addNode(workflow, type, { x: 90 + (workflow.nodes.length % 4) * 195, y: 370 })
    setWorkflow(next)
    setSelectedId(next.nodes[next.nodes.length - 1].id)
  }

  function linkBlocks({ source, target, sourceHandle }: Connection) {
    const branch = sourceHandle === 'yes' || sourceHandle === 'no' ? sourceHandle : 'next'
    setWorkflow(current => current && connect(current, { from: source, to: target, branch }))
  }

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

  const nodes: Block[] = (workflow?.nodes ?? []).map(node => ({
    id: node.id, type: 'workflow', position: { x: node.x, y: node.y },
    data: { kind: node.type, status: runView?.nodes[node.id]?.status, highlighted: highlight?.nodeIds.includes(node.id) }, selected: node.id === selectedId,
  }))
  const edges = (workflow?.edges ?? []).map(edge => {
    const highlighted = highlight?.edge?.from === edge.from && highlight.edge.branch === edge.branch
    const color = highlighted ? '#ffad9e' : '#659483'
    return {
      id: `${edge.from}:${edge.branch}`, source: edge.from, target: edge.to, sourceHandle: edge.branch,
      label: edge.branch === 'next' ? undefined : edge.branch === 'yes' ? 'Да' : 'Нет',
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: highlighted ? 3 : 1.6 },
      className: highlighted ? 'garden-ci-edge' : undefined,
    }
  })

  return (
    <main className="garden">
      <header className="garden-top"><span className="garden-brand"><b aria-hidden="true">✳</b> Cyber Garden</span><span>Редактор сценариев</span>
        {workflow?.id && <a href={`?view=templates&workflow=${encodeURIComponent(workflow.id)}`}>Шаблоны</a>}
        {workflow?.id && <a href={runsUrl(workflow.id)}>Запуски</a>}
      </header>
      <section className="garden-heading">
        <div><p className="garden-kicker">Сценарии</p><h1>{workflow?.name ?? 'Редактор Workflow'}</h1>
          {workflow && <p className="garden-meta">{workflow.id ? `${workflow.id} · Ревизия ${workflow.revision}` : 'Черновик'}</p>}
        </div>
        {workflow && <div className="garden-actions">
          <a href="?workflow=new">Новый сценарий</a>
          <label>Снимок<select value={snapshotId} disabled={pending} onChange={event => setSnapshotId(event.target.value)}>
            <option value="">Выберите снимок</option>
            {snapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{snapshot.label}</option>)}
          </select></label>
          <button disabled={pending} onClick={() => void submit('save')}>Сохранить</button>
          <button className="garden-primary" disabled={pending || !workflow.id || !snapshotId} onClick={() => void submit('run')}>▷ Запустить</button>
        </div>}
      </section>
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
      {workflow && <div className="garden-workspace">
        <aside className="garden-panel" aria-label="Палитра"><h2>Блоки</h2>
          {nodeTypes.map(type => <button key={type} disabled={pending} onClick={() => addBlock(type)}><span className="garden-icon" aria-hidden="true">{labels[type][1]}</span>{labels[type][0]}</button>)}
        </aside>
        <section className="garden-canvas" aria-label="Граф сценария">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={flowNodeTypes} className="dark" fitView
            fitViewOptions={{ padding: 0.18, maxZoom: 1 }} minZoom={0.2} maxZoom={2}
            nodesDraggable={!pending} nodesConnectable={!pending} deleteKeyCode={null}
            onNodesChange={moveNodes} onConnect={linkBlocks}
            onNodeClick={(_, node) => setSelectedId(node.id)} onPaneClick={() => setSelectedId('')}>
            <Background color="#34453f" gap={22} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </section>
        <aside className="garden-panel garden-settings" aria-label="Настройки блока"><h2>Настройки</h2>
          {activeNode ? <>
            <h3>{labels[activeNode.type][0]}</h3><p className="garden-meta">{activeNode.id}</p>
            <NodeSettings node={activeNode} schedule={workflow.schedule} disabled={pending}
              onSettingsChange={settings => setWorkflow(current => current && ({
                ...current, nodes: current.nodes.map(node => node.id === activeNode.id ? { ...node, settings } : node),
              }))}
              onScheduleChange={schedule => setWorkflow(current => current && ({ ...current, schedule }))} />
            <dl><dt>X</dt><dd>{Math.round(activeNode.x)}</dd><dt>Y</dt><dd>{Math.round(activeNode.y)}</dd></dl>
            {activeNodeView && <div className="garden-node-output">
              <h3>Данные запуска</h3>
              <p>{statuses[activeNodeView.status]}</p>
              {activeNodeView.input !== undefined && <><h4>Вход</h4><pre>{JSON.stringify(activeNodeView.input, null, 2)}</pre></>}
              {activeNodeView.output !== undefined && <><h4>Выход</h4><pre>{JSON.stringify(activeNodeView.output, null, 2)}</pre></>}
              {activeNodeView.error && <p>{activeNodeView.error.message}</p>}
            </div>}
            <button disabled={pending} onClick={() => {
              setWorkflow(current => current && removeNode(current, selectedId))
              setSelectedId('')
            }}>Удалить блок</button>
          </> : <p>Выберите блок на холсте.</p>}
        </aside>
      </div>}
    </main>
  )
}
