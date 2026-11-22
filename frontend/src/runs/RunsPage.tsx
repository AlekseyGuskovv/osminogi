import { PrismGlassCard } from '../ui/PrismGlassCard'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { WorkspaceNav } from '../ui/WorkspaceNav'
import { StatusBadge } from '../ui/StatusBadge'
import { apiUrl, getJson } from '../api'
import { TimeMachine } from '../security-replay/TimeMachine'
import { ExplainableCI } from '../security-replay/ExplainableCI'
import { useRunStatus } from './useRun'
import { ComparisonPage } from './ComparisonPage'
import { FixDialog } from './FixDialog'
import { FindingCard } from './FindingCard'
import { ThresholdPreview } from './ThresholdPreview'
import { RunOutcomeDialog } from './RunOutcomeDialog'
import { errorHelp, isRunFinished } from './outcome'
import type { Run } from './types'
import type { Workflow } from '../workflow'

import { getHighlight } from './ci'
import { runsUrl } from './navigation'

const catalogLabels = { training: 'Учебный', organizer: 'Организаторы', custom: 'Серверный файл', osv: 'OSV' } as const

function clearOutcomeLink() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('outcome')) return
  url.searchParams.delete('outcome')
  window.history.replaceState(window.history.state, '', url)
}

export function RunsPage({ workflowId, runId, openTimeMachine, showOutcome }: {
  workflowId: string; runId?: string; openTimeMachine?: boolean; showOutcome?: boolean
}) {
  const [runs, setRuns] = useState<Run[]>()
  const [run, setRun] = useState<Run>()
  const [watchedRun, setWatchedRun] = useState<string>()
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
          if (!isRunFinished(result.status)) {
            setWatchedRun(result.id)
            poll = setTimeout(() => void load(), 500)
          }
        } else if (workflowId === 'new') {
          if (active) setRuns([])
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
  const [explanationId, setExplanationId] = useState<string>()
  const [explanationWorkflow, setExplanationWorkflow] = useState<Workflow>()
  const explanationTrigger = useRef<HTMLButtonElement>(null)
  const explanation = Boolean(run && explanationId === run.id)
  const explanationWorkflowId = explanation ? run?.workflowId : undefined

  useEffect(() => {
    if (!explanationWorkflowId) return
    if (run?.graph) return
    let active = true
    void getJson<Workflow>(`/workflows/${encodeURIComponent(explanationWorkflowId)}`).then(workflow => {
      if (active) setExplanationWorkflow(workflow)
    }).catch(() => { /* The run still identifies the analyzer by node ID. */ })
    return () => { active = false }
  }, [explanationWorkflowId, run?.graph])

  function closeExplanation() {
    setExplanationId(undefined)
    explanationTrigger.current?.focus()
  }
  const live = useRunStatus(run?.status === 'queued' || run?.status === 'running' ? run.id : undefined)

  const metrics = runs && [
    ['Всего запусков', runs.length, 'total'],
    ['CI пройден', runs.filter(item => item.ci.status === 'passed').length, 'passed'],
    ['CI не пройден', runs.filter(item => item.ci.status === 'failed').length, 'failed'],
    ['С техническими ошибками', runs.filter(item => item.technicalErrors?.length || item.status === 'failed' || item.ci.status === 'error').length, 'error'],
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
          <a className="garden-run-link" href={runsUrl(workflowId, item.id)}><span><Icon name="runs" size={17} /></span>
            {item.createdAt ? <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ru-RU')}</time> : <code>{item.id}</code>}</a>
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
        {run.id === runId && isRunFinished(run.status) && (showOutcome || watchedRun === run.id) &&
          <RunOutcomeDialog key={run.id} run={run} onBeforeOpen={clearOutcomeLink} />}
        <div className="replay-controls">
          <button aria-expanded={timeMachine} onClick={() => setTimeMachine(value => !value)}>Машина времени безопасности</button>
          {run.status !== 'queued' && run.status !== 'running' && <>
            <a href={`?${new URLSearchParams({ workflow: run.workflowId, ciRun: run.id, replay: '1' })}`}>Повтор на графе</a>
            <a href={apiUrl(`/runs/${encodeURIComponent(run.id)}/report?format=markdown`)} download>Скачать отчёт</a>
          </>}
          {run.ci.status !== 'pending' && <button ref={explanationTrigger} aria-expanded={explanation} onClick={() => explanation
            ? closeExplanation() : setExplanationId(run.id)}>
            {run.ci.status === 'failed' ? 'Почему CI не пройден?' : 'Объяснение CI'}
          </button>}
        </div>
        {explanation && <ExplainableCI key={`explanation:${run.id}`} run={run} initialStep={0}
          analyzerType={(run.graph?.nodes ?? (explanationWorkflow?.id === run.workflowId ? explanationWorkflow.nodes : []))
            .find(node => node.id === run.ci.nodeId)?.type}
          onClose={closeExplanation}
          graphHref={`?${new URLSearchParams({ workflow: run.workflowId, ciRun: run.id, explain: '1' })}`} />}
        {timeMachine && <TimeMachine key={`time-machine:${run.id}`} workflowId={run.workflowId} initialId={run.id} />}
        <PrismGlassCard variant="featured" accent="mint" className="garden-run-summary" data-detail-ci={run.ci.status}>
          <div className="garden-run-summary-badges"><span>Выполнение сценария</span><StatusBadge kind="run" status={run.status} />
            <span>Проверка безопасности (CI)</span><StatusBadge kind="ci" status={run.ci.status} /></div>
          {run.report.summary && <p>{run.report.summary}</p>}
          <div className="garden-run-summary-meta"><span>Снимок <code>{run.snapshotId}</code></span><span>Ревизия <code>{run.workflowRevision}</code></span>
            {run.baseSnapshotId && <span>База PR <code>{run.baseSnapshotId}</code></span>}</div>
          {run.analysisVersion && <p className="garden-meta garden-catalog-meta" title={run.analysisVersion}>
            Справочник зависимостей · {run.catalogSource ? catalogLabels[run.catalogSource] : 'Из истории'} · <code>{run.analysisVersion}</code>
          </p>}
          {run.report.delivery === 'sent' && <p role="status">Отчёт доставлен в Telegram{run.report.messageId && ` · сообщение № ${run.report.messageId}`}</p>}
        </PrismGlassCard>
        {Boolean(run.technicalErrors?.length) && <section className="garden-integration-panel garden-run-errors" aria-label="Технические ошибки">
          <h2>Технические ошибки</h2>
          <ul>{run.technicalErrors?.map((item, index) => <li key={`${item.code}-${index}`}>
            <strong>{errorHelp[item.stage][0]}</strong><p>{item.message}</p><small>{errorHelp[item.stage][1]}</small>
          </li>)}</ul>
        </section>}
        {getHighlight(run.ci).nodeIds.length > 0 && <a
          href={`?${new URLSearchParams({ workflow: run.workflowId, ciRun: run.id })}`}>
          Показать решение CI на графе
        </a>}
        <div className="garden-findings-heading"><h2>Находки <span>{run.findings.length}</span></h2>
        </div>
        {run.findings.length === 0 && <p>Находок нет.</p>}
        <div className="garden-findings">
          {run.findings.map(finding => <FindingCard key={finding.id} finding={finding} workflowId={run.workflowId}
            recommendation={run.recommendations?.find(recommendation => recommendation.findingId === finding.id)}
            action={(run.fixableFindingIds?.includes(finding.id) ||
              (import.meta.env.VITE_USE_MOCKS === 'true' && run.snapshotId === 'pr-1' && finding.id === 'F-key'))
              ? <FixDialog run={run} findingId={finding.id} /> : undefined} />)}
        </div>
        {run.ci.gateNodeId && <ThresholdPreview key={`threshold:${run.id}:${run.ci.gateNodeId}`} runId={run.id} nodeId={run.ci.gateNodeId}
          settings={run.graph?.nodes.find(node => node.id === run.ci.gateNodeId)?.settings} />}
        {live && <section className="replay-panel" aria-label="Выполнение в реальном времени">
          <p className="replay-kicker">SECURITY PULSE · SSE</p>
          <StatusBadge kind="run" status={live.status} />
          <ul>{Object.entries(live.nodes).map(([id, node]) => <li key={id}><code>{id}</code> · {node.status}</li>)}</ul>
        </section>}
        {run.status !== 'queued' && run.status !== 'running' && <ComparisonPage key={`comparison:${run.id}`} run={run} />}
      </>}
    </section>
    </main>
  </div>
}
