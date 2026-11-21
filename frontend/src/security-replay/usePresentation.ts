import { useEffect, useState } from 'react'
import { getJson } from '../api'
import type { Run } from '../runs/types'

export function usePresentation(open: boolean, stage: number, workflowId?: string, replayId = 'run-1') {
  const [run, setRun] = useState<Run>()
  const [error, setError] = useState('')
  const id = stage === 0 ? replayId : stage === 3 ? 'run-2' : 'run-1'

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

  return {
    run: open && run?.id === id && run.workflowId === workflowId ? run : undefined,
    error: open ? error : '',
  }
}
