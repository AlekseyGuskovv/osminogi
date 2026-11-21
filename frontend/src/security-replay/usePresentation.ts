import { useEffect, useState } from 'react'
import { getJson } from '../api'
import type { Run } from '../runs/types'

export function usePresentation(open: boolean, stage: number, workflowId?: string, replayId = 'run-1') {
  const [run, setRun] = useState<Run>()
  const [error, setError] = useState('')
  const [history, setHistory] = useState<{ id: string; runs: Run[] }>()
  const mock = import.meta.env.VITE_USE_MOCKS === 'true'
  const choices = history?.id === workflowId ? history?.runs : undefined
  const id = mock ? (stage === 0 ? replayId || 'run-1' : stage === 3 ? 'run-2' : 'run-1')
    : choices?.find(item => item.id === replayId)?.id ?? choices?.[0]?.id

  useEffect(() => {
    if (!open || !workflowId) return
    let active = true
    void getJson<Run[]>(`/workflows/${encodeURIComponent(workflowId)}/runs`).then(runs => {
      if (active) {
        setError('')
        setHistory({ id: workflowId, runs: runs.filter(item => item.status === 'succeeded' || item.status === 'failed') })
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить историю.')
    })
    return () => { active = false }
  }, [open, workflowId])

  useEffect(() => {
    if (!open || !id) return
    let active = true
    void getJson<Run>(`/runs/${encodeURIComponent(id)}`).then(result => {
      if (!active) return
      if (result.workflowId !== workflowId) {
        setError('Этот запуск принадлежит другому сценарию.')
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
    run: open && run && run.id === id && run.workflowId === workflowId ? run : undefined,
    error: open ? error : '',
    choices,
    id,
  }
}
