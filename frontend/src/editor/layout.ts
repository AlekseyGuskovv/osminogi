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

  const rows = new Map<number, number>()
  return {
    ...draft,
    nodes: draft.nodes.map(node => {
      const column = levels.get(node.id)!
      const row = rows.get(column) ?? 0
      rows.set(column, row + 1)
      return { ...node, x: 40 + column * 232, y: 56 + row * 124 }
    }),
  }
}
