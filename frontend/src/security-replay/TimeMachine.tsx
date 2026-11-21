import { useEffect, useState } from 'react'
import { ApiError, getJson } from '../api'
import { FindingCard } from '../runs/FindingCard'
import type { Comparison, Run } from '../runs/types'
import { StatusBadge } from '../ui/StatusBadge'
import { ciSummary } from './state'

export function TimeMachine({ workflowId, initialId, demo = false, onFocus }: {
  workflowId: string; initialId: string; demo?: boolean; onFocus?: (run: Run) => void
}) {
  const [runs, setRuns] = useState<Run[]>()
  const [pair, setPair] = useState({ before: '', after: '' })
  const [phase, setPhase] = useState<'before' | 'after'>('after')
  const [result, setResult] = useState<{ key: string; before: Run; after: Run; diff: Comparison }>()
  const [loadingError, setLoadingError] = useState('')
  const [comparisonError, setComparisonError] = useState<{ key: string; text: string }>()
  const key = JSON.stringify(pair)

  useEffect(() => {
    let active = true
    void getJson<Run[]>(`/workflows/${encodeURIComponent(workflowId)}/runs`).then(history => {
      if (!active) return
      const completed = history.filter(run => run.status === 'succeeded' || run.status === 'failed')
      setRuns(completed)
      const index = completed.findIndex(run => run.id === initialId)
      setPair(demo
        ? { before: completed.find(run => run.id === 'run-1')?.id ?? '', after: completed.find(run => run.id === 'run-2')?.id ?? '' }
        : index >= 0 && index === completed.length - 1
          ? { before: completed[index].id, after: completed[index - 1]?.id ?? '' }
          : { before: completed[Math.max(0, index) + 1]?.id ?? '', after: completed[Math.max(0, index)]?.id ?? '' })
    }).catch((error: unknown) => { if (active) setLoadingError(error instanceof Error ? error.message : 'Не удалось загрузить историю.') })
    return () => { active = false }
  }, [workflowId, initialId, demo])

  useEffect(() => {
    if (!pair.before || !pair.after || pair.before === pair.after) return
    let active = true
    const before = encodeURIComponent(pair.before)
    const after = encodeURIComponent(pair.after)
    void Promise.all([
      getJson<Run>(`/runs/${before}`),
      getJson<Run>(`/runs/${after}`),
      getJson<Comparison>(`/runs/${after}/comparison?againstRunId=${before}`),
    ]).then(([first, second, diff]) => {
      if (active) { setComparisonError(undefined); setResult({ key, before: first, after: second, diff }) }
    }).catch((error: unknown) => {
      if (active) setComparisonError({ key, text: error instanceof ApiError && error.code === 'INCOMPARABLE_RUNS'
        ? 'Эти запуски нельзя сравнить. Выберите другой запуск.'
        : error instanceof Error ? error.message : 'Не удалось сравнить запуски.' })
    })
    return () => { active = false }
  }, [key, pair])

  const data = result?.key === key ? result : undefined
  const active = data?.[phase]
  const error = loadingError || (comparisonError?.key === key ? comparisonError.text : '')
  const filter = (side: 'before' | 'after', title: string) =>
    <label>{title}<select value={pair[side]} onChange={event => setPair({ ...pair, [side]: event.target.value })}>
      <option value="">Выберите запуск</option>
      {runs?.map(run => <option key={run.id} value={run.id}>{run.id} · {run.snapshotId}</option>)}
    </select></label>

  return <section className="replay-panel" aria-label="Машина времени безопасности">
    <header><div><p className="replay-kicker">СОХРАНЁННЫЕ СОСТОЯНИЯ</p><h2>Security Time Machine</h2></div></header>
    <div className="replay-pair">{filter('before', 'До')}{filter('after', 'После')}</div>
    <div className="replay-controls">
      <button aria-pressed={phase === 'before'} onClick={() => { setPhase('before'); if (data) onFocus?.(data.before) }}>До</button>
      <button aria-pressed={phase === 'after'} onClick={() => { setPhase('after'); if (data) onFocus?.(data.after) }}>После</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!error && !runs && <p role="status">Загружаем запуски…</p>}
    {!error && runs && (!pair.before || !pair.after || pair.before === pair.after) && <p>Выберите два разных завершённых запуска.</p>}
    {!error && !data && pair.before && pair.after && pair.before !== pair.after && <p role="status">Загружаем сравнение…</p>}
    {data && active && <>
      <div className="replay-pair">{[data.before, data.after].map((run, i) =>
        <div key={run.id} className="replay-result"><span>{i === 0 ? 'До' : 'После'} · <code>{run.id}</code></span>
          <StatusBadge kind="ci" status={run.ci.status} /></div>)}</div>
      <div key={active.id} className="replay-swap" data-replay-phase={phase}>
        <p><strong>{ciSummary(active)}</strong> · Находок: {active.findings.length}
          {phase === 'after' && <> · Новых: {data.diff.introduced.length} · Сохранилось: {data.diff.existing.length}</>}</p>
        <a href={`?${new URLSearchParams({ workflow: workflowId, ciRun: active.id, explain: '1' })}`}>Показать решение на графе</a>
        {phase === 'after' && <section className="replay-resolved"><h3>Устранено · {data.diff.resolved.length}</h3>
          {!data.diff.resolved.length && <p>Устранённых находок нет.</p>}
          <div className="garden-findings">{data.diff.resolved.map(id => {
            const finding = data.before.findings.find(item => item.id === id)
            return finding ? <FindingCard key={id} finding={finding} /> : <code key={id}>{id}</code>
          })}</div></section>}
        {!active.findings.length && <p>Актуальных находок нет.</p>}
        <div className="garden-findings">{active.findings.map(finding => <FindingCard key={finding.id} finding={finding}
          recommendation={active.recommendations.find(item => item.findingId === finding.id)} />)}</div>
      </div>
    </>}
  </section>
}
