import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { WorkspaceNav } from '../ui/WorkspaceNav'
import { StatusBadge } from '../ui/StatusBadge'
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

  return <div className="garden-shell">
    <WorkspaceNav workflowId={workflowId} section="runs" />
    <main className="garden">
    <section className="garden-results">
      <p className="garden-kicker">Рабочее пространство <span>/</span> Запуски {runId && <><span>/</span> {runId}</>}</p>
      <div className="garden-page-heading">
        <div><h1>{runId ? `Запуск ${runId}` : 'История запусков'}</h1><code>{workflowId}</code></div>
        {runId && <a className="garden-subtle-action" href={runsUrl(workflowId)}>Все запуски</a>}
      </div>
      {error && <><p role="alert">{error}</p><button onClick={() => { setError(''); setAttempt(value => value + 1) }}>Повторить</button></>}
      {!error && !run && !runs && <p role="status">Загрузка…</p>}
      {runs && runs.length > 0 && <div className="garden-run-table">
        <div className="garden-run-columns" aria-hidden="true"><span>Запуск</span><span>Снимок</span><span>Выполнение</span><span>CI</span><span /></div>
        <ul className="garden-run-list">
        {runs.map(item => <li key={item.id}>
          <a className="garden-run-link" href={runsUrl(workflowId, item.id)}><span><Icon name="runs" size={17} /></span><code>{item.id}</code></a>
          <code>{item.snapshotId}</code><StatusBadge kind="run" status={item.status} /><StatusBadge kind="ci" status={item.ci.status} />
          <a aria-label={`Открыть ${item.id}`} href={runsUrl(workflowId, item.id)}><Icon name="arrow" size={17} /></a>
        </li>)}
        </ul>
      </div>}
      {runs?.length === 0 && <p>У сценария пока нет запусков.</p>}
      {run && <>
        <div className="garden-run-summary" data-detail-ci={run.ci.status}>
          <div className="garden-run-summary-badges"><span>Выполнение</span><StatusBadge kind="run" status={run.status} />
            <span>CI</span><StatusBadge kind="ci" status={run.ci.status} /></div>
          {run.report.summary && <p>{run.report.summary}</p>}
          <div className="garden-run-summary-meta"><span>Снимок <code>{run.snapshotId}</code></span><span>Ревизия <code>{run.workflowRevision}</code></span>
            {run.baseSnapshotId && <span>База PR <code>{run.baseSnapshotId}</code></span>}</div>
        </div>
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
  </div>
}
