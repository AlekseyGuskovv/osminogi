export const nodeTypes = ['start', 'secrets', 'sca', 'sast', 'ai', 'condition', 'telegram', 'finish'] as const
export type NodeType = typeof nodeTypes[number]
export type Branch = 'next' | 'yes' | 'no'
export type WorkflowDraft = {
  name: string
  schedule: { time: string; timezone: string } | null
  snapshotId?: string
  nodes: { id: string; type: NodeType; x: number; y: number; settings: Record<string, unknown> }[]
  edges: { from: string; to: string; branch: Branch }[]
}
export type Workflow = WorkflowDraft & { id: string; revision: number }
