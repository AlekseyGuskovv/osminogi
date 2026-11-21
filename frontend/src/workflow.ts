export const nodeTypes = ['start', 'secrets', 'sca', 'sast', 'gradle', 'coverage', 'ai', 'condition', 'telegram', 'finish'] as const
export type NodeType = typeof nodeTypes[number]
export type Branch = 'next' | 'yes' | 'no'
export type WorkflowDraft = {
  name: string
  schedule: { time: string; timezone: string } | null
  snapshotId?: string | null
  nodes: { id: string; type: NodeType; x: number; y: number; settings: Record<string, unknown>; name?: string; description?: string }[]
  edges: { from: string; to: string; branch: Branch }[]
}
export type Workflow = WorkflowDraft & { id: string; revision: number }

export type ConnectionRef = { id: string; type: 'telegram'; name: string; configured: boolean }

export type WorkflowDraftResult = WorkflowDraft & { warnings: string[] }
