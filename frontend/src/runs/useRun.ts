import { useRef, useState } from 'react'
import { postJson } from '../api'

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
