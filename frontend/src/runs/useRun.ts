import { useEffect, useRef, useState } from 'react'
import { getJson, postJson } from '../api.ts'
import { subscribeRun } from './events.ts'
import type { Ci, Run } from './types.ts'
import type { CiStatus, RunEvent, RunStatus } from './events.ts'
import { isRunFinished } from './outcome.ts'

export type RunRequest = {
  trigger: 'manual' | 'schedule' | 'ci'
  snapshotId: string
  baseSnapshotId?: string
}

export type RunAccepted = { id: string; status: 'queued' }

export function startRun(workflowId: string, body: RunRequest): Promise<RunAccepted> {
  return postJson<RunAccepted>(`/workflows/${encodeURIComponent(workflowId)}/runs`, body)
}

export function useStartRun() {
  const inFlight = useRef(false)
  const [starting, setStarting] = useState(false)
  const [accepted, setAccepted] = useState<RunAccepted>()

  async function start(workflowId: string, body: RunRequest) {
    if (inFlight.current) return
    inFlight.current = true
    setStarting(true)
    setAccepted(undefined)
    try {
      const run = await startRun(workflowId, body)
      setAccepted(run)
      return run
    } finally {
      inFlight.current = false
      setStarting(false)
    }
  }

  return { start, starting, accepted, clearAccepted: () => setAccepted(undefined) }
}


type NodeView = { branch?: 'yes' | 'no'; status: RunStatus | 'skipped'; input?: unknown; output?: unknown; error?: { code: string; message: string } }
export type RunView = {
  id: string
  status: RunStatus
  ciStatus?: CiStatus
  ci?: Ci
  result?: Run
  nodes: Record<string, NodeView>
  lastNodeEvent?: { id: string; seq: number; output?: unknown }
}
export function applyRunEvent(view: RunView, event: RunEvent): RunView {
  if (event.runId !== view.id) return view
  if (event.type === 'run.status') return { ...view, status: event.data.status }
  if (event.type === 'run.finished') return { ...view, status: event.data.status, ciStatus: event.data.ciStatus }

  const { nodeId, ...change } = event.data
  return { ...view, lastNodeEvent: { id: nodeId, seq: event.seq, output: change.output }, nodes: { ...view.nodes, [nodeId]: { ...view.nodes[nodeId], ...change } } }
}

export function useRunStatus(runId?: string, onEvent?: (event: RunEvent) => void) {
  const [view, setView] = useState<RunView>()

  useEffect(() => {
    if (!runId) return
    const id = runId
    let active = true
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    async function refresh() {
      const run = await getJson<Run>(`/runs/${encodeURIComponent(id)}`)
      const finished = isRunFinished(run.status)
      if (active) setView(current => {
        const nodes = { ...(current?.id === id ? current.nodes : undefined) }
        for (const { nodeId, ...step } of run.steps) {
          nodes[nodeId] = { ...nodes[nodeId], ...step }
        }
        return { id, status: run.status, ciStatus: run.ci.status, ci: run.ci, nodes, result: finished ? run : undefined }
      })
      return !finished
    }

    async function refreshFinished() {
      try {
        if (!await refresh()) return
      } catch {
        // The completed report may be temporarily unavailable while reconnecting.
      }
      if (active && ++attempts < 4) retry = setTimeout(() => void refreshFinished(), 1250)
    }

    const unsubscribe = subscribeRun(id, async event => {
      onEvent?.(event)
      setView(current => applyRunEvent(
        current?.id === id ? current : { id, status: 'queued', nodes: {} },
        event,
      ))
      if (event.type === 'run.finished') await refreshFinished()
    }, refresh)
    return () => {
      active = false
      clearTimeout(retry)
      unsubscribe()
    }
  }, [runId, onEvent])

  return view?.id === runId ? view : undefined
}
