import type { WorkflowDraft } from '../workflow'

export function orderGraph<Draft extends WorkflowDraft>(draft: Draft): Draft {
  const levels = new Map(draft.nodes.map(node => [node.id, 0]))
  const incoming = new Map(draft.nodes.map(node => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of draft.edges) {
    if (!levels.has(edge.from) || !levels.has(edge.to)) continue
    incoming.set(edge.to, incoming.get(edge.to)! + 1)
    const targets = outgoing.get(edge.from) ?? []
    targets.push(edge.to)
    outgoing.set(edge.from, targets)
  }
  const queue = draft.nodes.filter(node => incoming.get(node.id) === 0).map(node => node.id)
  for (const id of queue) {
    for (const target of outgoing.get(id) ?? []) {
      levels.set(target, Math.max(levels.get(target)!, levels.get(id)! + 1))
      const remaining = incoming.get(target)! - 1
      incoming.set(target, remaining)
      if (remaining === 0) queue.push(target)
    }
  }
  if (queue.length !== draft.nodes.length) return draft

  const columns = new Map<number, typeof draft.nodes>()
  const verticalOrder = new Map<string, number>()
  for (const node of draft.nodes) {
    const column = levels.get(node.id)!
    const items = columns.get(column) ?? []
    items.push(node)
    columns.set(column, items)
  }
  const positions = new Map<string, { x: number; y: number }>()
  for (const [column, nodes] of [...columns].sort(([a], [b]) => a - b)) {
    const weight = (id: string) => {
      const parents = draft.edges.filter(edge => edge.to === id)
      if (!parents.length) return 0
      return parents.reduce((sum, edge) => sum + (verticalOrder.get(edge.from) ?? 0) +
        (edge.branch === 'yes' ? -.5 : edge.branch === 'no' ? .5 : 0), 0) / parents.length
    }
    const sorted = [...nodes].sort((a, b) => weight(a.id) - weight(b.id) || a.id.localeCompare(b.id))
    for (const [index, node] of sorted.entries()) {
      const row = index - (sorted.length - 1) / 2
      verticalOrder.set(node.id, row)
      positions.set(node.id, { x: 40 + column * 204, y: 72 + row * 112 })
    }
  }
  const minY = Math.min(40, ...[...positions.values()].map(point => point.y))
  return {
    ...draft,
    nodes: draft.nodes.map(node => {
      const position = positions.get(node.id)!
      return { ...node, x: position.x, y: position.y + 40 - minY }
    }),
  }
}
