import { useEffect, useState } from 'react'
import { getJson } from '../api'
import { ComparisonPage } from './ComparisonPage'
import { FindingCard } from './FindingCard'
import type { Run } from './types'

import { runsUrl } from './navigation'

export function RunsPage({ workflowId, runId }: { workflowId: string; runId?: string }) {
  const [runs, setRuns] = useState<Run[]>()
  const [run, setRun] = useState<Run>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const query = runId
      ? getJson<Run>(`/runs/${encodeURIComponent(runId)}`).then(result => { if (active) setRun(result) })
      : getJson<Run[]>(`/workflows/${encodeURIComponent(workflowId)}/runs`).then(result => { if (active) setRuns(result) })
    void query.catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить запуски.')
    })
    return () => { active = false }
  }, [workflowId, runId, attempt])

  return <main className="garden">
    <header className="garden-top"><span className="garden-brand"><b aria-hidden="true">✳</b> Cyber Garden</span>
      <a href={`?workflow=${encodeURIComponent(workflowId)}`}>Редактор</a>
      <a href={runsUrl(workflowId)}>Запуски</a>
    </header>
    <section className="garden-results">
      <p className="garden-kicker">{workflowId}</p>
      <h1>{runId ? `Запуск ${runId}` : 'История запусков'}</h1>
      {error && <><p role="alert">{error}</p><button onClick={() => { setError(''); setAttempt(value => value + 1) }}>Повторить</button></>}
      {!error && !run && !runs && <p role="status">Загрузка…</p>}
      {runs && <ul className="garden-run-list">
        {runs.map(item => <li key={item.id}>
          <a href={runsUrl(workflowId, item.id)}>{item.id}</a>
          <span>{item.snapshotId}</span><span>CI · {item.ci.status}</span>
        </li>)}
      </ul>}
      {runs?.length === 0 && <p>У сценария пока нет запусков.</p>}
      {run && <>
        <p>{run.report.summary}</p>
        <p className="garden-meta">Снимок {run.snapshotId} · CI {run.ci.status}</p>
        <h2>Находки</h2>
        {run.findings.length === 0 && <p>Находок нет.</p>}
        <div className="garden-findings">
          {run.findings.map(finding => <FindingCard key={finding.id} finding={finding}
            recommendation={run.recommendations.find(recommendation => recommendation.findingId === finding.id)} />)}
        </div>
        <ComparisonPage key={run.id} run={run} />
      </>}
    </section>
  </main>
}
