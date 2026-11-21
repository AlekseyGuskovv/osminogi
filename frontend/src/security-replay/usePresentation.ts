import { useEffect, useState } from 'react'
import { getJson } from '../api'
import { subscribeRun } from '../runs/events'
import type { RunEvent } from '../runs/events'
import type { Run } from '../runs/types'
import { applyRunEvent } from '../runs/useRun'
import type { RunView } from '../runs/useRun'

export function usePresentation(open: boolean, stage: number, workflowId?: string) {
  const [run, setRun] = useState<Run>()
  const [error, setError] = useState('')
  const [events, setEvents] = useState<RunEvent[]>([])
  const [cursor, setCursor] = useState(0)
  const [paused, setPaused] = useState(false)
  const [repetition, setRepetition] = useState(0)
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
    let collected: RunEvent[] = []
    return subscribeRun(run.id, event => {
      collected = [...collected, event]
      setEvents(collected)
    }, async () => {
      if (!collected.length) setError('Для запуска нет доступной записи событий.')
      return false
    })
  }, [open, stage, run, workflowId])

  useEffect(() => {
    if (!open || stage !== 0 || paused || cursor >= events.length) return
    const timer = window.setTimeout(() => setCursor(value => value + 1), 650)
    return () => window.clearTimeout(timer)
  }, [open, stage, paused, cursor, events.length, repetition])

  function restart() {
    setCursor(0)
    setPaused(false)
    setRepetition(value => value + 1)
  }

  const view: RunView | undefined = open && stage === 0 && run?.id === 'run-1'
    ? events.slice(0, cursor).reduce(applyRunEvent, { id: run.id, status: 'queued', nodes: {} } as RunView)
    : undefined

  return {
    run: open && run?.id === id && run.workflowId === workflowId ? run : undefined,
    view, error: open ? error : '', paused, setPaused, restart,
  }
}
