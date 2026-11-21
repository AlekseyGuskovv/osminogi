import { useEffect, useState } from 'react'
import { getJson } from '../api'
import { ComparisonPage } from './ComparisonPage'
import { FixDialog } from './FixDialog'
import { FindingCard } from './FindingCard'
import { ThresholdPreview } from './ThresholdPreview'
import type { Run } from './types'

import { getHighlight } from './ci'
import { runsUrl } from './navigation'

export function RunsPage({ workflowId, runId }: { workflowId: string; runId?: string }) {
  const [runs, setRuns] = useState<Run[]>()
  const [run, setRun] = useState<Run>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let poll: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        if (runId) {
          const result = await getJson<Run>(`/runs/${encodeURIComponent(runId)}`)
          if (!active) return
          setRun(result)
          if (result.status === 'queued' || result.status === 'running') poll = setTimeout(() => void load(), 500)
        } else {
          const results = await getJson<Run[]>(`/workflows/${encodeURIComponent(workflowId)}/runs`)
          if (active) setRuns(results)
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить запуски.')
      }
    }
    void load()
    return () => { active = false; clearTimeout(poll) }
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
        <p className="garden-meta" data-detail-ci={run.ci.status}>Снимок {run.snapshotId} · CI {run.ci.status}</p>
        {getHighlight(run.ci).nodeIds.length > 0 && <a
          href={`?${new URLSearchParams({ workflow: run.workflowId, ciRun: run.id })}`}>
          Показать решение CI на графе
        </a>}
        <h2>Находки</h2>
        {run.findings.length === 0 && <p>Находок нет.</p>}
        <div className="garden-findings">
          {run.findings.map(finding => <FindingCard key={finding.id} finding={finding} workflowId={run.workflowId}
            recommendation={run.recommendations.find(recommendation => recommendation.findingId === finding.id)} />)}
        </div>
        {run.snapshotId === 'pr-1' && run.findings.some(finding => finding.id === 'F-key') &&
          <FixDialog key={run.id} run={run} findingId="F-key" />}
        {run.ci.gateNodeId && <ThresholdPreview key={run.id} runId={run.id} nodeId={run.ci.gateNodeId} />}
        <ComparisonPage key={run.id} run={run} />
      </>}
    </section>
  </main>
}
