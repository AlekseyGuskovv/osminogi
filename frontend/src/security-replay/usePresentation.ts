import { useEffect, useRef, useState } from 'react'
import { getJson } from '../api'
import { subscribeRun } from '../runs/events'
import type { Run } from '../runs/types'
import { emptyReplay, recordEvent } from './playback'
import type { ReplayLog } from './playback'

export function usePresentation(open: boolean, stage: number, workflowId?: string) {
  const [run, setRun] = useState<Run>()
  const [error, setError] = useState('')
  const [log, setLog] = useState<ReplayLog>()
  const recorded = useRef<ReplayLog>(undefined)
  const id = stage === 3 ? 'run-2' : 'run-1'

  useEffect(() => {
    if (!open) return
    let active = true
    void getJson<Run>(`/runs/${id}`).then(result => {
      if (!active) return
      if (result.workflowId !== workflowId) {
        setError('Откройте сценарий wf-1, чтобы показать его демонстрационные запуски.')
        return
      }
      setError('')
      setRun(result)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Демонстрационный запуск недоступен.')
    })
    return () => { active = false }
  }, [open, id, workflowId])

  useEffect(() => {
    if (!open || stage !== 0 || run?.id !== 'run-1' || run.workflowId !== workflowId) return
    if (recorded.current?.events.at(-1)?.type === 'run.finished') return
    let collected = recorded.current ?? emptyReplay(run.id)
    return subscribeRun(run.id, event => {
      collected = recordEvent(collected, event)
      recorded.current = collected
      setLog(collected)
    }, async () => {
      if (!collected.events.length) setError('Для запуска нет доступной записи событий.')
      return false
    })
  }, [open, stage, run, workflowId])

  return {
    run: open && run?.id === id && run.workflowId === workflowId ? run : undefined,
    log: open && stage === 0 && run?.id === id && run.workflowId === workflowId ? log : undefined,
    error: open ? error : '',
  }
}
