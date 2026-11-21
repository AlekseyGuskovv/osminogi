import { useCallback, useState } from 'react'
import type { RunEvent } from '../runs/events'
import { useRunStatus } from '../runs/useRun'
import { emptyReplay, recordEvent } from './playback'
import type { ReplayLog } from './playback'

export function useRecordedRun(runId?: string) {
  const [log, setLog] = useState<ReplayLog>()
  const record = useCallback((event: RunEvent) => {
    setLog(current => recordEvent(current?.base.id === event.runId ? current : emptyReplay(event.runId), event))
  }, [])
  const view = useRunStatus(runId, record)
  return { view, log: log?.base.id === runId ? log : undefined }
}
