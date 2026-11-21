import type { RunEvent } from '../runs/events.ts'
import type { Run } from '../runs/types.ts'
import type { WorkflowDraft } from '../workflow.ts'
import { emptyReplay } from './playback.ts'
import type { ReplayLog } from './playback.ts'

export function reconstructRoute(workflow: WorkflowDraft, run: Run): ReplayLog | undefined {
  if (run.status !== 'succeeded' && run.status !== 'failed') return
  const start = workflow.nodes.find(node => node.type === 'start')
  if (!start) return
  const nodes = new Map(workflow.nodes.map(node => [node.id, node]))
  const steps = new Map(run.steps.map(step => [step.nodeId, step]))
  const id = `reconstruction-${run.id}`
  const events: RunEvent[] = []
  const reconstructed = new Set<string>()
  const visited = new Set<string>()
  const meta = () => ({ runId: id, seq: events.length + 1, at: '' })
  events.push({ ...meta(), type: 'run.status', data: { status: 'running' } })
  for (const step of run.steps) {
    if (step.status === 'skipped') events.push({ ...meta(), type: 'node.status', data: step })
  }
  let node = start
  while (node && !visited.has(node.id)) {
    const step = steps.get(node.id)
    if (step?.status === 'skipped') break
    visited.add(node.id)
    if (!step) reconstructed.add(node.id)
    const branch = node.type === 'condition'
      ? step?.branch ?? (run.ci.gateNodeId === node.id ? run.ci.branch : undefined) : 'next'
    events.push({ ...meta(), type: 'node.status', data: { nodeId: node.id, status: 'running' } })
    events.push({ ...meta(), type: 'node.status', data: {
      nodeId: node.id,
      status: step?.status === 'failed' ? 'failed' : 'succeeded',
      output: branch === 'yes' || branch === 'no' ? { branch } : undefined,
    } })
    if (step?.status === 'failed') break
    const edge = workflow.edges.find(edge => edge.from === node.id && edge.branch === branch)
    const next = edge && nodes.get(edge.to)
    if (!next) break
    node = next
  }
  events.push({ ...meta(), type: 'run.finished', data: { status: run.status, ciStatus: run.ci.status } })
  return { ...emptyReplay(id), events, source: 'reconstruction', reconstructed }
}
