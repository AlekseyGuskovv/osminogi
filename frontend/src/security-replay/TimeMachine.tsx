import { PrismGlassCard } from '../ui/PrismGlassCard'
import { PrismIcon } from '../ui/Icon'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError, getJson } from '../api'
import { getHighlight } from '../runs/ci'
import { FindingCard } from '../runs/FindingCard'
import type { Comparison, Run } from '../runs/types'
import { criticalCount, evolutionResult, isCompleted, resolvedIds } from './evolution'
import './time-machine.css'

type Phase = 'before' | 'after'
type Pair = Record<Phase, string>
type MachineProps = { workflowId: string; initialId: string; demo?: boolean; onFocus?: (run: Run | undefined) => void }
const ciLabels = { failed: 'CI FAILED', passed: 'CI PASSED', error: 'Ошибка CI', pending: 'CI ожидается' }

export function TimeMachine(props: MachineProps) {
  return <History key={JSON.stringify([props.workflowId, props.initialId, props.demo])} {...props} />
}

function History({ workflowId, initialId, demo = false, onFocus }: MachineProps) {
  const [history, setHistory] = useState<Run[]>()
  const [pair, setPair] = useState<Pair>({ before: '', after: '' })
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void getJson<Run[]>(`/workflows/${encodeURIComponent(workflowId)}/runs`).then(runs => {
      if (!active) return
      setHistory(runs)
      const completed = runs.filter(isCompleted)
      if (demo) {
        setPair({
          before: completed.find(run => run.id === 'run-1')?.id ?? '',
          after: completed.find(run => run.id === 'run-2')?.id ?? '',
        })
      } else {
        setPair({ before: completed[1]?.id ?? '', after: completed[0]?.id ?? '' })
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить историю.')
    })
    return () => { active = false }
  }, [workflowId, initialId, demo])

  const completed = history?.filter(isCompleted)
  const ready = completed && completed.length >= 2
  const valid = ready && pair.before && pair.after && pair.before !== pair.after
  const picker = (side: Phase, label: string) => <label>{label}
    <select value={pair[side]} onChange={event => setPair({ ...pair, [side]: event.target.value })}>
      <option value="">Выберите запуск</option>
      {history?.map(run => <option key={run.id} value={run.id} disabled={!isCompleted(run)}>
        {run.createdAt ? new Date(run.createdAt).toLocaleString('ru-RU') : run.id} · {run.snapshotId}{!isCompleted(run) && ' · выполняется'}
      </option>)}
    </select>
  </label>

  return <section className="replay-panel evolution" aria-label="Машина времени безопасности">
    <header><div><h2>Security Time Machine</h2><p>Сравните результаты двух сохранённых проверок.</p></div></header>
    {history && history.length > 0 && <div className="evolution-select">{picker('before', 'Запуск до')}{picker('after', 'Запуск после')}</div>}
    {error && <p role="alert">{error}</p>}
    {!error && !history && <p role="status">Загружаем запуски…</p>}
    {history?.length === 0 && <p>Запусков пока нет.</p>}
    {history && history.length > 0 && !ready && <p>Для сравнения нужны два завершённых запуска.</p>}
    {ready && (!pair.before || !pair.after) && <p>Выберите два завершённых запуска.</p>}
    {ready && pair.before && pair.before === pair.after && <p role="alert">Выберите разные запуски.</p>}
    {valid && <ComparisonRequest key={JSON.stringify(pair)} pair={pair} workflowId={workflowId} onFocus={onFocus} />}
  </section>
}

function ComparisonRequest({ pair, workflowId, onFocus }: { pair: Pair; workflowId: string; onFocus: MachineProps['onFocus'] }) {
  const [result, setResult] = useState<{ before: Run; after: Run; diff: Comparison }>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const before = encodeURIComponent(pair.before)
    const after = encodeURIComponent(pair.after)
    void Promise.all([
      getJson<Run>(`/runs/${before}`),
      getJson<Run>(`/runs/${after}`),
      getJson<Comparison>(`/runs/${after}/comparison?againstRunId=${before}`),
    ]).then(([first, second, diff]) => {
      if (!active) return
      if (!isCompleted(first) || !isCompleted(second)) {
        setError('Дождитесь завершения обоих запусков.')
      } else if (first.workflowId !== workflowId || second.workflowId !== workflowId || (diff.againstRunId && diff.againstRunId !== pair.before)) {
        setError('Ответ сравнения не соответствует выбранным запускам.')
      } else {
        setResult({ before: first, after: second, diff })
      }
    }).catch((reason: unknown) => {
      if (!active) return
      setError(reason instanceof ApiError && (reason.code === 'INCOMPARABLE_RUNS' || reason.status === 409)
        ? 'Эти запуски нельзя сравнить. Выберите другую пару.'
        : reason instanceof Error ? reason.message : 'Не удалось сравнить запуски.')
    })
    return () => { active = false }
  }, [pair.before, pair.after, workflowId])

  if (error) return <p role="alert">{error}</p>
  if (!result) return <p role="status">Загружаем сравнение…</p>
  return <Evolution {...result} onFocus={onFocus} />
}

function Evolution({ before, after, diff, onFocus }: { before: Run; after: Run; diff: Comparison; onFocus: MachineProps['onFocus'] }) {
  const [phase, setPhase] = useState<Phase>('after')
  const list = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, DOMRect>())
  const active = phase === 'before' ? before : after
  const resolved = resolvedIds(after, diff)
  const result = evolutionResult(before, after, resolved, phase)
  const highlight = getHighlight(active.ci)
  const criticalBefore = criticalCount(before)
  const criticalAfter = criticalCount(after)
  const regression = phase === 'after' && criticalAfter > criticalBefore
  const cards = [
    ...active.findings.map(finding => ({ id: finding.id, finding, historical: false })),
    ...(phase === 'after' ? resolved.map(id => ({ id, finding: before.findings.find(item => item.id === id), historical: true })) : []),
  ]

  useEffect(() => {
    onFocus?.(active)
    return () => onFocus?.(undefined)
  }, [active, onFocus])

  function select(next: Phase) {
    if (next === phase) return
    positions.current = new Map()
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const card of list.current?.querySelectorAll<HTMLElement>('[data-evolution-card]') ?? []) {
        positions.current.set(card.dataset.evolutionCard!, card.getBoundingClientRect())
      }
    }
    setPhase(next)
  }

  useLayoutEffect(() => {
    for (const card of list.current?.querySelectorAll<HTMLElement>('[data-evolution-card]') ?? []) {
      card.getAnimations().forEach(animation => animation.cancel())
      const old = positions.current.get(card.dataset.evolutionCard!)
      if (!old) continue
      const next = card.getBoundingClientRect()
      const x = old.x - next.x
      const y = old.y - next.y
      if (x || y) card.animate([
        { transform: `translate(${x}px, ${y}px)` },
        { transform: 'translate(0, 0)' },
      ], { duration: 490, easing: 'cubic-bezier(.2,.7,.2,1)' })
    }
    positions.current.clear()
  }, [phase])

  const endpoint = (side: Phase, title: string, run: Run) => <div className="evolution-endpoint" data-selected={side === phase}>
    <button type="button" aria-pressed={side === phase} onClick={() => select(side)}>{title}</button>
    <code>{run.id}</code><span className="evolution-snapshot">{run.snapshotId}</span>
    <span className="evolution-ci" data-ci={run.ci.status}>{ciLabels[run.ci.status]}</span>
  </div>

  return <div className="evolution-content" data-replay-phase={phase}>
    <div className="evolution-track" role="group" aria-label="Шкала сравнения">
      {endpoint('before', 'До', before)}
      <div className="evolution-track-line"><span>Изменение</span><i aria-hidden="true" /></div>
      {endpoint('after', 'После', after)}
    </div>
    <dl className="evolution-metrics" aria-label="Показатели сравнения">
      <div><dt>Актуальные</dt><dd><b>{before.findings.length}</b> <span><PrismIcon name="arrow" size={15} /></span> <b>{after.findings.length}</b></dd></div>
      <div><dt>Критические</dt><dd><b>{criticalBefore}</b> <span><PrismIcon name="arrow" size={15} /></span> <b>{criticalAfter}</b></dd></div>
      <div><dt>Устранено</dt><dd>{resolved.length}</dd></div>
      <div><dt>Осталось</dt><dd>{after.findings.length}</dd></div>
    </dl>
    <PrismGlassCard variant="featured" accent="mint" className="evolution-outcome" data-ci={active.ci.status}
      data-regression={regression} aria-live="polite">
      <span className="evolution-result-icon" aria-hidden="true"><PrismIcon name={active.ci.status === 'passed' && !regression ? 'check' : active.ci.status === 'pending' ? 'clock' : 'alert'} size={16} /></span>
      <div className="evolution-result-copy" key={phase}><strong>{result.title}</strong><p>{result.detail}</p></div>
    </PrismGlassCard>
    <div className="evolution-findings" ref={list}>
      <h3 className="evolution-active-heading">Актуальные находки <span>{active.findings.length}</span></h3>
      <h3 className="evolution-resolved-heading">Устранено <span>{phase === 'after' ? resolved.length : '—'}</span></h3>
      {!active.findings.length && <p className="evolution-active-card">Актуальных находок нет.</p>}
      {phase === 'before' && <p className="evolution-resolved-card">Выберите «После», чтобы увидеть устранённые находки.</p>}
      {phase === 'after' && !resolved.length && <p className="evolution-resolved-card">Подтверждённых устранений нет.</p>}
      {cards.map(({ id, finding, historical }) => <div key={id} data-evolution-card={id}
        className={historical ? 'replay-resolved evolution-resolved-card' : 'evolution-active-card'}>
        {finding ? <FindingCard finding={finding} variant={historical ? 'resolved' : 'compact'}
          recommendation={(historical ? before : active).recommendations.find(item => item.findingId === id)} />
          : <p><code>{id}</code> · Устранено. Историческая карточка недоступна.</p>}
      </div>)}
    </div>
    <div className="evolution-workflow">
      <div><strong>Решение на графе</strong>
        {highlight.nodeIds.length ? <p className="evolution-chain">
          {highlight.nodeIds.map(id => <code key={id}>{id}</code>)}
          {highlight.edge && <strong>{highlight.edge.branch.toUpperCase()}</strong>}
          <span className="evolution-ci" data-ci={active.ci.status}>{ciLabels[active.ci.status]}</span>
        </p> : <p>Для подсветки этого решения нет данных.</p>}
      </div>
      {highlight.nodeIds.length > 0 && <a href={`?${new URLSearchParams({ workflow: active.workflowId, ciRun: active.id, explain: '1' })}`}>
        Показать решение на графе
      </a>}
    </div>
  </div>
}
