import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { WorkspaceNav } from '../ui/WorkspaceNav'
import { StatusBadge } from '../ui/StatusBadge'
import { getJson } from '../api'
import { TimeMachine } from '../security-replay/TimeMachine'
import { ExplainableCI } from '../security-replay/ExplainableCI'
import { useRunStatus } from './useRun'
import { ComparisonPage } from './ComparisonPage'
import { FixDialog } from './FixDialog'
import { FindingCard } from './FindingCard'
import { ThresholdPreview } from './ThresholdPreview'
import type { Run } from './types'

import { getHighlight } from './ci'
import { runsUrl } from './navigation'

export function RunsPage({ workflowId, runId, openTimeMachine }: { workflowId: string; runId?: string; openTimeMachine?: boolean }) {
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

  const [timeMachine, setTimeMachine] = useState(Boolean(openTimeMachine))
  const [explanation, setExplanation] = useState(false)
  const live = useRunStatus(run?.status === 'queued' || run?.status === 'running' ? run.id : undefined)

  const metrics = runs && [
    ['Всего запусков', runs.length, 'total'],
    ['CI пройден', runs.filter(item => item.ci.status === 'passed').length, 'passed'],
    ['CI не пройден', runs.filter(item => item.ci.status === 'failed').length, 'failed'],
    ['Технические ошибки', runs.filter(item => item.status === 'failed' || item.ci.status === 'error').length, 'error'],
  ] as const

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
      {metrics && <dl className="garden-run-metrics">
        {metrics.map(([label, count, tone]) => <div key={tone} data-metric={tone}><dt>{label}</dt><dd>{count}</dd></div>)}
      </dl>}
      {runs && runs.length > 0 && <div className="garden-run-table">
        <div className="garden-run-columns" aria-hidden="true"><span>Запуск</span><span>Снимок</span><span>Выполнение</span><span>Безопасность (CI)</span><span>Находки</span><span /></div>
        <ul className="garden-run-list">
        {runs.map(item => <li key={item.id}>
          <a className="garden-run-link" href={runsUrl(workflowId, item.id)}><span><Icon name="runs" size={17} /></span><code>{item.id}</code></a>
          <code>{item.snapshotId}</code><StatusBadge kind="run" status={item.status} /><StatusBadge kind="ci" status={item.ci.status} /><span className="garden-run-count">{item.status === 'queued' || item.status === 'running' ? '—' : item.findings.length}</span>
          <a aria-label={`Открыть ${item.id}`} href={runsUrl(workflowId, item.id)}><Icon name="arrow" size={17} /></a>
        </li>)}
        </ul>
      </div>}
      {runs && runs.length > 0 && <p className="garden-meta">Сценарий может завершиться, а CI — не пройти, если найдены критические риски.</p>}
      {runs?.length === 0 && <section className="garden-template-empty"><Icon name="runs" size={25} /><h2>Запусков пока нет</h2><p>Выберите снимок проекта и запустите сценарий в конструкторе.</p>
        <a className="garden-subtle-action" href={`?workflow=${encodeURIComponent(workflowId)}`}>Открыть конструктор</a>
      </section>}
      {run && <>
        <div className="garden-run-summary" data-detail-ci={run.ci.status}>
          <div className="garden-run-summary-badges"><span>Выполнение сценария</span><StatusBadge kind="run" status={run.status} />
            <span>Проверка безопасности (CI)</span><StatusBadge kind="ci" status={run.ci.status} /></div>
          {run.report.summary && <p>{run.report.summary}</p>}
          <div className="garden-run-summary-meta"><span>Снимок <code>{run.snapshotId}</code></span><span>Ревизия <code>{run.workflowRevision}</code></span>
            {run.baseSnapshotId && <span>База PR <code>{run.baseSnapshotId}</code></span>}</div>
        </div>
        {getHighlight(run.ci).nodeIds.length > 0 && <a
          href={`?${new URLSearchParams({ workflow: run.workflowId, ciRun: run.id })}`}>
          Показать решение CI на графе
        </a>}
        <div className="garden-findings-heading"><h2>Находки <span>{run.findings.length}</span></h2>
          {run.snapshotId === 'pr-1' && run.findings.some(finding => finding.id === 'F-key') &&
            <FixDialog key={run.id} run={run} findingId="F-key" />}
        </div>
        {run.findings.length === 0 && <p>Находок нет.</p>}
        <div className="garden-findings">
          {run.findings.map(finding => <FindingCard key={finding.id} finding={finding} workflowId={run.workflowId}
            recommendation={run.recommendations.find(recommendation => recommendation.findingId === finding.id)} />)}
        </div>
        {run.ci.gateNodeId && <ThresholdPreview key={run.id} runId={run.id} nodeId={run.ci.gateNodeId} />}
        {live && <section className="replay-panel" aria-label="Выполнение в реальном времени">
          <p className="replay-kicker">SECURITY PULSE · SSE</p>
          <StatusBadge kind="run" status={live.status} />
          <ul>{Object.entries(live.nodes).map(([id, node]) => <li key={id}><code>{id}</code> · {node.status}</li>)}</ul>
        </section>}
        <div className="replay-controls">
          <button aria-expanded={timeMachine} onClick={() => setTimeMachine(value => !value)}>Машина времени безопасности</button>
          {run.ci.status !== 'pending' && <button aria-expanded={explanation} onClick={() => setExplanation(value => !value)}>
            {run.ci.status === 'failed' ? 'Почему CI не пройден?' : 'Объяснение CI'}
          </button>}
        </div>
        {explanation && <ExplainableCI key={run.id} run={run} onClose={() => setExplanation(false)} />}
        {explanation && <a href={`?${new URLSearchParams({ workflow: run.workflowId, ciRun: run.id, explain: '1' })}`}>
          Открыть объяснение на графе
        </a>}
        {timeMachine && <TimeMachine key={run.id} workflowId={run.workflowId} initialId={run.id} />}
        <ComparisonPage key={run.id} run={run} />
      </>}
    </section>
    </main>
  </div>
}
