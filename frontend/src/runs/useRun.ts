import { useEffect, useRef, useState } from 'react'
import { getJson, postJson } from '../api'
import { subscribeRun } from './events'
import type { CiStatus, RunStatus } from './events'

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

  return { start, starting, accepted }
}


type RunSummary = { id: string; status: RunStatus; ci: { status: CiStatus } }

export function useRunStatus(runId?: string) {
  const [view, setView] = useState<{ id: string; status: RunStatus; ciStatus?: CiStatus }>()

  useEffect(() => {
    if (!runId) return
    const id = runId
    let active = true
    async function refresh() {
      const run = await getJson<RunSummary>(`/runs/${encodeURIComponent(id)}`)
      if (active) setView({ id, status: run.status, ciStatus: run.ci.status })
      return run.status === 'queued' || run.status === 'running'
    }

    const unsubscribe = subscribeRun(id, async event => {
      if (event.type === 'run.status') setView({ id, status: event.data.status })
      if (event.type === 'run.finished') {
        setView({ id, status: event.data.status, ciStatus: event.data.ciStatus })
        await refresh()
      }
    }, refresh)
    return () => {
      active = false
      unsubscribe()
    }
  }, [runId])

  return view?.id === runId ? view : undefined
}
