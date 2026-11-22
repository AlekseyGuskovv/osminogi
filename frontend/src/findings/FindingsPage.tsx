import { useEffect, useRef, useState } from 'react'
import { getJson, postJson } from '../api'
import { FindingCard } from '../runs/FindingCard'
import { runsUrl } from '../runs/navigation'
import { severityLabels } from '../runs/types'
import type { Finding } from '../runs/types'
import { WorkspaceNav } from '../ui/WorkspaceNav'
import type { Workflow } from '../workflow'
import type { FindingRecord, FindingReview, FindingReviewStatus, FindingsOverview } from './types'
import './findings.css'

const categories: Readonly<Record<string, string>> = {
  SECRET: 'Секреты', SCA: 'Зависимости', SAST: 'Kotlin-код', GRADLE: 'Gradle',
}
const states = { open: 'Актуальна', resolved: 'Устранена', unverified: 'Нужно перепроверить' }
const reviewLabels: Record<FindingReviewStatus, string> = {
  unreviewed: 'Не разобрана', in_progress: 'В работе', false_positive: 'Ложное срабатывание',
}
const severityRank = { critical: 0, high: 1, medium: 2, low: 3 }
const dates = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })

function findingsPath(workflowId: string) {
  return `/workflows/${encodeURIComponent(workflowId)}/findings`
}

function dateLabel(value: string | null) {
  const time = value ? Date.parse(value) : NaN
  return Number.isFinite(time) ? dates.format(time) : '—'
}

function locationLabel(finding: Finding) {
  const dependency = finding.group && finding.artifact ? `${finding.group}:${finding.artifact}` : ''
  return [dependency, finding.advisoryId].filter(Boolean).join(' · ') || `${finding.path}:${finding.line}`
}

function matchesSearch(finding: Finding, terms: string[]) {
  const searchText = [finding.title, finding.path, finding.ruleId, finding.advisoryId, finding.group,
    finding.artifact, finding.version, `${finding.group ?? ''}:${finding.artifact ?? ''}`,
    ...(finding.advisoryAliases ?? [])].join(' ').toLowerCase()
  return terms.every(term => searchText.includes(term))
}

function ReviewForm({ workflowId, record, onSave }: {
  workflowId: string; record: FindingRecord; onSave: (review: FindingReview) => void
}) {
  const startingStatus = record.review?.status ?? 'unreviewed'
  const [status, setStatus] = useState<FindingReviewStatus>(startingStatus)
  const [reason, setReason] = useState(record.review?.reason ?? '')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const dirty = status !== startingStatus || reason.trim() !== (record.review?.reason ?? '')

  async function save() {
    if (pending || !dirty) return
    setPending(true)
    setMessage('')
    setError('')
    try {
      const path = `${findingsPath(workflowId)}/${encodeURIComponent(record.finding.id)}/review`
      const review = await postJson<FindingReview>(path, { status, reason: reason.trim() })
      setReason(review.reason)
      onSave(review)
      setMessage('Разбор сохранён.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить разбор.')
    } finally {
      setPending(false)
    }
  }

  return <form className="finding-review-form" onSubmit={event => { event.preventDefault(); void save() }}>
    <h3>Разбор находки</h3>
    <label>Статус<select value={status} disabled={pending} onChange={event => {
      setStatus(event.target.value as FindingReviewStatus)
      setMessage('')
    }}>
      {Object.entries(reviewLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label>{status === 'false_positive' ? 'Причина ложного срабатывания' : 'Комментарий'}
      <textarea rows={3} value={reason} maxLength={500} required={status === 'false_positive'} disabled={pending}
        onChange={event => { setReason(event.target.value); setMessage('') }} />
    </label>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <button className="garden-primary" disabled={pending || !dirty || (status === 'false_positive' && !reason.trim())}>
      {pending ? 'Сохранение…' : 'Сохранить разбор'}
    </button>
  </form>
}

export function FindingsPage({ initialWorkflowId }: { initialWorkflowId: string }) {
  const [workflows, setWorkflows] = useState<Workflow[]>()
  const workflow = workflows?.find(item => item.id === initialWorkflowId) ?? workflows?.[0]
  const workflowId = workflow?.id
  const [overview, setOverview] = useState<FindingsOverview>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('active')
  const [selectedId, setSelectedId] = useState<string>()
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    let active = true
    void getJson<Workflow[]>('/workflows').then(result => {
      if (active) setWorkflows(result)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить сценарии.')
    })
    return () => { active = false }
  }, [attempt])

  useEffect(() => {
    if (!workflowId) return
    let active = true
    void getJson<FindingsOverview>(findingsPath(workflowId)).then(result => {
      if (active) setOverview(result)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить находки.')
    })
    return () => { active = false }
  }, [workflowId, attempt])

  const records = overview?.findings ?? []
  const selected = records.find(record => record.finding.id === selectedId)
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const visible = records.filter(record => {
    const review = record.review?.status ?? 'unreviewed'
    const matchesStatus = status === 'all' || status === record.state || status === review ||
      (status === 'active' && record.state !== 'resolved' && review !== 'false_positive')
    return matchesStatus && (!severity || severity === record.finding.severity) &&
      (!category || category === record.category) && matchesSearch(record.finding, terms)
  }).sort((left, right) => severityRank[left.finding.severity] - severityRank[right.finding.severity])

  function saveReview(review: FindingReview) {
    setOverview(current => current && {
      ...current,
      findings: current.findings.map(record => record.finding.id === review.findingId ? { ...record, review } : record),
    })
  }

  return <div className="garden-shell">
    <WorkspaceNav workflowId={workflowId ?? initialWorkflowId} section="findings" />
    <main className="garden">
      <section className="garden-results findings-page">
        <div className="garden-page-heading findings-heading">
          <h1>Находки</h1>
          {workflowId && <label>Сценарий<select value={workflowId} onChange={event => {
            window.location.assign(`?${new URLSearchParams({ view: 'findings', workflow: event.target.value })}`)
          }}>
            {workflows?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>}
        </div>
        {error && <><p role="alert">{error}</p><button onClick={() => {
          setError('')
          setAttempt(value => value + 1)
        }}>Повторить</button></>}
        {!error && (!workflows || (workflowId && !overview)) && <p role="status">Загрузка находок…</p>}
        {!error && workflows?.length === 0 && <div className="findings-empty">
          <h2>Создайте сценарий проверки</h2>
          <a className="garden-subtle-action" href="?workflow=new">Открыть конструктор</a>
        </div>}
        {!error && workflowId && overview && records.length === 0 && <div className="findings-empty">
          <h2>{overview.latestRunId ? 'Находок пока нет' : 'По сценарию ещё нет результатов'}</h2>
          <a className="garden-subtle-action" href={overview.latestRunId ? runsUrl(workflowId, overview.latestRunId)
            : `?workflow=${encodeURIComponent(workflowId)}`}>{overview.latestRunId ? 'Открыть отчёт' : 'Открыть конструктор'}</a>
        </div>}
        {!error && records.length > 0 && <>
          <div className="findings-filters">
            <label className="findings-search">Поиск<input type="search" value={search} placeholder="CVE, библиотека, файл или правило"
              onChange={event => setSearch(event.target.value)} /></label>
            <label>Критичность<select value={severity} onChange={event => setSeverity(event.target.value)}>
              <option value="">Любая</option>
              {Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>Тип проверки<select value={category} onChange={event => setCategory(event.target.value)}>
              <option value="">Все типы</option>
              {Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>Статус<select value={status} onChange={event => setStatus(event.target.value)}>
              <option value="active">Требуют внимания</option>
              <option value="all">Все статусы</option>
              {Object.entries(states).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value="in_progress">В работе</option>
              <option value="false_positive">Ложное срабатывание</option>
            </select></label>
          </div>
          <p className="garden-meta" role="status">Показано {visible.length} из {records.length}</p>
          {visible.length === 0 ? <div className="findings-empty">
            <h2>По выбранным фильтрам ничего нет</h2>
            <button onClick={() => { setSearch(''); setSeverity(''); setCategory(''); setStatus('all') }}>Показать все находки</button>
          </div> : <div className="findings-table-wrap">
            <table className="findings-table" aria-label="Находки сценария">
              <thead><tr><th>Находка</th><th>Тип</th><th>Критичность</th><th>Статус</th><th>Последний раз найдена</th></tr></thead>
              <tbody>{visible.map(record => <tr key={record.finding.id}>
                <td><button className="findings-open" onClick={() => {
                  setSelectedId(record.finding.id)
                  dialog.current?.showModal()
                }}>{record.finding.title}</button><code className="findings-location">{locationLabel(record.finding)}</code></td>
                <td>{categories[record.category] ?? record.category}</td>
                <td><span className="garden-severity" data-severity={record.finding.severity}>{severityLabels[record.finding.severity]}</span></td>
                <td><span className="findings-state" data-state={record.state}>{states[record.state]}</span>
                  {record.review && record.review.status !== 'unreviewed' &&
                    <small className="findings-review-label">{reviewLabels[record.review.status]}</small>}</td>
                <td>{dateLabel(record.lastSeenAt)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </>}
        <dialog className="garden-dialog findings-dialog" ref={dialog} aria-labelledby="finding-details-title"
          onClose={() => setSelectedId(undefined)}>
          <div className="findings-dialog-heading">
            <h2 id="finding-details-title">Детали находки</h2>
            <button type="button" onClick={() => dialog.current?.close()}>Закрыть</button>
          </div>
          {selected && workflowId && <>
            <p className="garden-meta">{states[selected.state]} · Впервые: {dateLabel(selected.firstSeenAt)} · Запусков с находкой: {selected.occurrences}</p>
            {selected.state === 'unverified' && <p className="garden-meta">Для подтверждения исправления нужен запуск с сопоставимым набором анализаторов и справочником.</p>}
            <FindingCard key={selected.finding.id} finding={selected.finding} workflowId={workflowId}
              recommendation={selected.recommendation ?? undefined} />
            <a className="garden-subtle-action findings-report-link" href={runsUrl(workflowId, selected.lastSeenRunId)}>Открыть отчёт запуска</a>
            <ReviewForm key={selected.finding.id} workflowId={workflowId} record={selected} onSave={saveReview} />
          </>}
        </dialog>
      </section>
    </main>
  </div>
}
