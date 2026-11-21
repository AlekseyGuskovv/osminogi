import type { RunEvent } from '../runs/events.ts'
import { applyRunEvent } from '../runs/useRun.ts'
import type { RunView } from '../runs/useRun.ts'
import type { WorkflowDraft } from '../workflow.ts'
import { branchOf } from './state.ts'

type Edge = WorkflowDraft['edges'][number]

export const speeds = [0.5, 1, 2] as const
export type PlaybackSpeed = typeof speeds[number]
export const scannerDuration = 1800
export const historyLimit = 160

export type ReplayLog = { base: RunView; events: readonly RunEvent[]; offset: number }

export function emptyReplay(id: string): ReplayLog {
  return { base: { id, status: 'queued', nodes: {} }, events: [], offset: 0 }
}

export function recordEvent(log: ReplayLog, event: RunEvent): ReplayLog {
  if (event.runId !== log.base.id || event.seq <= (log.events.at(-1)?.seq ?? 0)) return log
  const events = [...log.events, event]
  if (events.length <= historyLimit) return { ...log, events }

  const dropped = events.shift()!
  return { base: applyRunEvent(log.base, dropped), events, offset: log.offset + 1 }
}

export function advanceTime(elapsed: number, delta: number, speed: PlaybackSpeed, paused: boolean) {
  return paused ? elapsed : elapsed + Math.max(0, delta) * speed
}

export function frameDuration(event: RunEvent, travels: boolean) {
  if (event.type === 'run.finished') return 650
  if (event.type !== 'node.status' || event.data.status === 'skipped' || event.data.status === 'queued') return 0
  return travels ? 2050 : event.data.status === 'running' ? scannerDuration : 900
}

export function frameProgress(elapsed: number, travels: boolean) {
  const travel = Math.max(0, Math.min(1, (elapsed - 550) / 1250))
  return {
    travel,
    trail: travels && elapsed >= 550 ? Math.min(1, (elapsed - 550) / 110, Math.max(0, (2050 - elapsed) / 250)) : 0,
    arrival: travels ? Math.max(0, 1 - Math.abs(elapsed - 1800) / 250) : 0,
  }
}

export function confirmedEdge(event: RunEvent, previous: RunView, edges: readonly Edge[]) {
  if (event.type !== 'node.status') return
  const branch = branchOf(event.data.output)
  if (branch && event.data.status === 'succeeded') return edges.find(edge => edge.from === event.data.nodeId && edge.branch === branch)
  if (event.data.status !== 'running') return
  const source = previous.lastNodeEvent?.id
  if (!source || previous.nodes[source]?.status !== 'succeeded') return
  return edges.find(edge => edge.branch === 'next' && edge.from === source && edge.to === event.data.nodeId)
}
