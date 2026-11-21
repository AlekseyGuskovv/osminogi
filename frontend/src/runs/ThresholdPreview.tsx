import { useState } from 'react'
import { postJson } from '../api'
import type { Finding } from './types'
import { ConditionRules } from '../editor/ConditionRules'

type Severity = Finding['severity']
type Preview = { branch: 'yes' | 'no'; wouldNotify: boolean }

export function ThresholdPreview({ runId, nodeId, settings }: {
  runId: string; nodeId: string; settings?: Record<string, unknown>
}) {
  const metric = settings?.metric
  const count = metric === 'findingCount'
  const regex = metric === 'findingTitle'
  const compound = Array.isArray(settings?.rules)
  const [group, setGroup] = useState(() => settings ?? {})
  const [value, setValue] = useState<string | number>(
    count ? Number(settings?.value ?? 1) : String(settings?.value ?? (regex ? '' : 'critical')),
  )
  const [preview, setPreview] = useState<Preview>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function check() {
    if (pending) return
    setPending(true)
    setError('')
    setPreview(undefined)
    try {
      setPreview(await postJson<Preview>(`/runs/${encodeURIComponent(runId)}/threshold-preview`, { nodeId, value: compound ? group : value }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Предпросмотр не удался.')
    } finally {
      setPending(false)
    }
  }

  function change(next: string | number) {
    setValue(next)
    setPreview(undefined)
    setError('')
  }

  return <section className="garden-preview" aria-label="Предпросмотр порога">
    <h2>Предпросмотр порога</h2>
    <form onSubmit={event => { event.preventDefault(); void check() }}>
      {compound ? <ConditionRules settings={group} disabled={pending} onChange={next => {
        setGroup(next)
        setPreview(undefined)
        setError('')
      }} /> : count ? <label>Минимум находок<input required type="number" min="0" max="5000" step="1"
        value={Number.isFinite(value) ? value : ''} disabled={pending} onChange={event => change(event.currentTarget.valueAsNumber)} /></label>
        : regex ? <label>Шаблон названия<input required value={value} disabled={pending} onChange={event => change(event.target.value)} /></label>
        : <label>Критичность<select value={value} disabled={pending} onChange={event => change(event.target.value as Severity)}>
        <option value="low">Низкая</option>
        <option value="medium">Средняя</option>
        <option value="high">Высокая</option>
        <option value="critical">Критическая</option>
      </select></label>}
      <button disabled={pending}>{pending ? 'Расчёт…' : 'Предпросмотр'}</button>
    </form>
    {preview && <p role="status" data-preview-branch={preview.branch}>
      Ветка «{preview.branch === 'yes' ? 'Да' : 'Нет'}» · {preview.wouldNotify ? 'Будет отправлено уведомление' : 'Уведомление не отправляется'}
    </p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
