import type { NodeType, WorkflowDraft } from '../workflow.ts'

export type Point = { x: number; y: number }

export function addNode<Draft extends WorkflowDraft>(draft: Draft, type: NodeType, position: Point): Draft {
  let suffix = 1
  const usedIds = new Set(draft.nodes.map(node => node.id))
  while (usedIds.has(`${type}-${suffix}`)) suffix++

  const settings = type === 'condition'
    ? { metric: 'maxSeverity', operator: 'gte', value: 'critical' }
    : {}
  return {
    ...draft,
    nodes: [...draft.nodes, { id: `${type}-${suffix}`, type, ...position, settings }],
  }
}

export function connect<Draft extends WorkflowDraft>(draft: Draft, edge: WorkflowDraft['edges'][number]): Draft {
  const { from, to, branch } = edge
  const source = draft.nodes.find(node => node.id === from)
  const target = draft.nodes.find(node => node.id === to)
  if (!source || !target || from === to || source.type === 'finish' || target.type === 'start') return draft
  if (source.type === 'condition' ? branch !== 'yes' && branch !== 'no' : branch !== 'next') return draft

  const previous = draft.edges.find(link => link.from === from && link.branch === branch)
  if (previous?.to === to) return draft
  const edges = draft.edges.filter(link => link !== previous)
  const pending = [to]
  const visited = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (id === from) return draft
    if (visited.has(id)) continue
    visited.add(id)
    for (const link of edges) {
      if (link.from === id) pending.push(link.to)
    }
  }

  return { ...draft, edges: [...edges, edge] }
}

export function removeNode<Draft extends WorkflowDraft>(draft: Draft, nodeId: string): Draft {
  if (!draft.nodes.some(node => node.id === nodeId)) return draft
  return {
    ...draft,
    nodes: draft.nodes.filter(node => node.id !== nodeId),
    edges: draft.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId),
  }
}
