import { useEffect, useState } from 'react'
import { ApiError, getJson } from '../api'
import { getHighlight } from './ci'
import { FindingCard } from './FindingCard'
import type { Comparison, Run } from './types'

type Props = { run: Run }

const groups = [
  ['introduced', 'Новые'],
  ['existing', 'Уже было'],
  ['resolved', 'Устранено'],
] as const

const reasons = {
  CRITICAL_FOUND: 'В текущем снимке есть критическая находка. CI завершён с ошибкой независимо от того, когда она появилась.',
  NO_CRITICAL: 'В текущем снимке нет критических находок.',
  SCAN_FAILED: 'Анализ завершён не полностью. CI не может подтвердить результат.',
  NO_ANALYSIS: 'Запуск не содержал ни одной выполненной проверки.',
  PENDING: 'Проверка ещё выполняется.',
}

function showCiReason(run: Run) {
  return {
    ...getHighlight(run.ci),
    message: run.ci.reason ? reasons[run.ci.reason] : undefined,
  }
}

export function ComparisonPage({ run }: Props) {
  const [previousRuns, setPreviousRuns] = useState<Run[]>()
  const [againstRunId, setAgainstRunId] = useState('')
  const [comparison, setComparison] = useState<{
    key: string
    result?: Comparison
    previous?: Run
    error?: string
  }>()
  const [listError, setListError] = useState('')

  useEffect(() => {
    let active = true
    void getJson<Run[]>(`/workflows/${encodeURIComponent(run.workflowId)}/runs`)
      .then(history => {
        if (!active) return
        const current = history.findIndex(item => item.id === run.id)
        const previous = current === -1 ? [] : history.slice(current + 1)
          .filter(item => item.ci.status === 'passed' || item.ci.status === 'failed')
        setPreviousRuns(previous)
        if (!run.baseSnapshotId) setAgainstRunId(id => id || previous[0]?.id || '')
      })
      .catch((error: unknown) => {
        if (active) setListError(error instanceof Error ? error.message : 'Не удалось загрузить историю.')
      })
    return () => { active = false }
  }, [run.id, run.workflowId, run.baseSnapshotId])

  useEffect(() => {
    if (!againstRunId && !run.baseSnapshotId) return
    let active = true
    const params = new URLSearchParams()
    if (againstRunId) params.set('againstRunId', againstRunId)
    const suffix = againstRunId ? `?${params}` : ''
    const path = `/runs/${encodeURIComponent(run.id)}/comparison${suffix}`
    void Promise.all([
      getJson<Comparison>(path),
      againstRunId ? getJson<Run>(`/runs/${encodeURIComponent(againstRunId)}`) : undefined,
    ]).then(([result, previous]) => {
      if (active) setComparison({ key: againstRunId, result, previous })
    }).catch((error: unknown) => {
      if (!active) return
      const message = error instanceof ApiError && error.code === 'INCOMPARABLE_RUNS'
        ? 'Эти запуски нельзя сравнить. Выберите другой запуск.'
        : error instanceof Error ? error.message : 'Не удалось загрузить сравнение.'
      setComparison({ key: againstRunId, error: message })
    })
    return () => { active = false }
  }, [run.id, run.baseSnapshotId, againstRunId])

  const current = comparison?.key === againstRunId ? comparison : undefined
  const findings = new Map([
    ...(!againstRunId ? run.resolvedFindings ?? [] : []).map(finding => [finding.id, finding] as const),
    ...(current?.previous?.findings ?? []).map(finding => [finding.id, finding] as const),
    ...run.findings.map(finding => [finding.id, finding] as const),
  ])

  const reason = showCiReason(run)

  return <section className="garden-comparison" aria-label="Сравнение">
    <h2>Сравнение</h2>
    <a href={`?${new URLSearchParams({ view: 'runs', workflow: run.workflowId, run: run.id, replay: '1' })}`}>
      Сравнить в машине времени
    </a>
    {reason.message && <aside className="garden-ci-reason" data-ci-reason={run.ci.reason} aria-label="Причина CI">
      <strong>Причина CI</strong>
      <p>{reason.message}{reason.findingId && ` · ${reason.findingId}`}</p>
      {reason.nodeIds.length > 0 && <a href={`?${new URLSearchParams({ workflow: run.workflowId, ciRun: run.id })}`}>Показать на графе</a>}
    </aside>}
    <label>Сравнить с <select value={againstRunId} onChange={event => setAgainstRunId(event.target.value)}>
      <option value="">{run.baseSnapshotId ? `Базовый снимок · ${run.baseSnapshotId}` : 'Выберите предыдущий запуск'}</option>
      {previousRuns?.map(item => <option key={item.id} value={item.id}>Запуск {item.id} · {item.snapshotId}</option>)}
    </select></label>
    {listError && <p role="alert">{listError}</p>}
    {!current && (againstRunId || run.baseSnapshotId || !previousRuns ? <p role="status">Загрузка сравнения…</p>
      : <p>{previousRuns.length ? 'Выберите запуск для сравнения.' : 'Для сравнения нужен базовый снимок или предыдущий завершённый запуск.'}</p>)}
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.result && <div className="garden-comparison-grid">
      {groups.map(([key, label]) => {
        const ids = current.result?.[key] ?? []
        return <section key={key} data-comparison-group={key}>
          <h3>{label} <span>{ids.length}</span></h3>
          {ids.length === 0 && <p>Нет находок</p>}
          {ids.map(id => {
            const finding = findings.get(id)
            const source = key === 'resolved' ? current.previous : run
            const recommendation = source?.recommendations.find(item => item.findingId === id)
            return finding ? <FindingCard key={id} finding={finding} recommendation={recommendation} /> : <p key={id}>{id}</p>
          })}
        </section>
      })}
    </div>}
  </section>
}
