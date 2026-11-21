import type { Ci } from './types'

export function getHighlight(ci: Ci) {
  const nodeIds = [...new Set([ci.nodeId, ci.gateNodeId].filter((id): id is string => Boolean(id)))]
  const edge = ci.gateNodeId && ci.branch
    ? { from: ci.gateNodeId, branch: ci.branch }
    : undefined
  return { nodeIds, edge, findingId: ci.findingId ?? undefined }
}
