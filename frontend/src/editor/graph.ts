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
