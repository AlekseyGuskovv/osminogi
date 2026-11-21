import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react'
import type { Connection, Node, NodeChangeset, NodeProps } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { getJson, postJson } from '../api'
import { nodeTypes } from '../workflow'
import type { NodeType, Workflow } from '../workflow'
import { addNode, connect } from './graph'
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

type Block = Node<{ kind: NodeType }, 'workflow'>
type Snapshot = { id: string; label: string }
export type EditorProps = { workflowId: string }

function WorkflowBlock({ data, selected }: NodeProps<Block>) {
  const { kind } = data
  const [label, icon] = labels[kind]
  return (
    <div className={`garden-node ${selected ? 'selected' : ''}`}>
      {kind !== 'start' && <Handle type="target" position={Position.Left} />}
      <span className="garden-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
      {kind === 'condition' ? <>
        <Handle type="source" id="yes" position={Position.Right} style={{ top: '32%' }} />
        <Handle type="source" id="no" position={Position.Right} style={{ top: '72%' }} />
      </> : kind !== 'finish' && <Handle type="source" id="next" position={Position.Right} />}
    </div>
  )
}

const flowNodeTypes = { workflow: WorkflowBlock }

export function WorkflowEditor({ workflowId }: EditorProps) {
  const [workflow, setWorkflow] = useState<Workflow>()
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [snapshotId, setSnapshotId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
  const activeNode = workflow?.nodes.find(node => node.id === selectedId)

  useEffect(() => {
    let active = true
    void Promise.all([
      getJson<Workflow>(`/workflows/${encodeURIComponent(workflowId)}`),
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
    setPending(true)
    setNotice(undefined)
    const path = `/workflows/${encodeURIComponent(workflow.id)}`
    try {
      if (action === 'save') {
        const saved = await postJson<Workflow>(`${path}/save`, { ...workflow, snapshotId: snapshotId || undefined })
        setWorkflow(saved)
        setNotice({ text: `Сохранено · ревизия ${saved.revision}` })
      } else {
        const run = await postJson<{ id: string; status: 'queued' }>(`${path}/runs`, { trigger: 'manual', snapshotId })
        setNotice({ text: `${run.id} поставлен в очередь` })
      }
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Не удалось выполнить запрос.', error: true })
    } finally {
      setPending(false)
    }
  }

  const nodes: Block[] = (workflow?.nodes ?? []).map(node => ({
    id: node.id, type: 'workflow', position: { x: node.x, y: node.y },
    data: { kind: node.type }, selected: node.id === selectedId,
  }))
  const edges = (workflow?.edges ?? []).map(edge => ({
    id: `${edge.from}:${edge.branch}`, source: edge.from, target: edge.to, sourceHandle: edge.branch,
    label: edge.branch === 'next' ? undefined : edge.branch === 'yes' ? 'Да' : 'Нет',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#659483' },
    style: { stroke: '#659483', strokeWidth: 1.6 },
  }))

  return (
    <main className="garden">
      <header className="garden-top"><span className="garden-brand"><b aria-hidden="true">✳</b> Cyber Garden</span><span>Редактор сценариев</span></header>
      <section className="garden-heading">
        <div><p className="garden-kicker">Сценарии</p><h1>{workflow?.name ?? 'Редактор Workflow'}</h1>
          {workflow && <p className="garden-meta">{workflow.id} · Ревизия {workflow.revision}</p>}
        </div>
        {workflow && <div className="garden-actions">
          <label>Снимок<select value={snapshotId} disabled={pending} onChange={event => setSnapshotId(event.target.value)}>
            <option value="">Выберите снимок</option>
            {snapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{snapshot.label}</option>)}
          </select></label>
          <button disabled={pending} onClick={() => void submit('save')}>Сохранить</button>
          <button className="garden-primary" disabled={pending || !snapshotId} onClick={() => void submit('run')}>▷ Запустить</button>
        </div>}
      </section>
      {notice && <p className={`garden-notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
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
            {activeNode.type === 'condition' && <p>Порог · {String(activeNode.settings.value ?? '—')}</p>}
            {activeNode.type === 'telegram' && <p>Канал · {String(activeNode.settings.channelId ?? '—')}</p>}
            <dl><dt>X</dt><dd>{Math.round(activeNode.x)}</dd><dt>Y</dt><dd>{Math.round(activeNode.y)}</dd></dl>
          </> : <p>Выберите блок на холсте.</p>}
        </aside>
      </div>}
    </main>
  )
}
