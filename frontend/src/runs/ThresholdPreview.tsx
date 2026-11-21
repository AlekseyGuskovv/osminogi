import { useState } from 'react'
import { postJson } from '../api'
import type { Finding } from './types'

type Severity = Finding['severity']
type Preview = { nodeId: string; value: Severity; branch: 'yes' | 'no'; wouldNotify: boolean }

export function ThresholdPreview({ runId, nodeId }: { runId: string; nodeId: string }) {
  const [value, setValue] = useState<Severity>('critical')
  const [preview, setPreview] = useState<Preview>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function check() {
    if (pending) return
    setPending(true)
    setError('')
    setPreview(undefined)
    try {
      setPreview(await postJson<Preview>(`/runs/${encodeURIComponent(runId)}/threshold-preview`, { nodeId, value }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Предпросмотр не удался.')
    } finally {
      setPending(false)
    }
  }

  return <section className="garden-preview" aria-label="Предпросмотр порога">
    <h2>Предпросмотр порога</h2>
    <form onSubmit={event => { event.preventDefault(); void check() }}>
      <label>Критичность<select value={value} disabled={pending} onChange={event => {
        setValue(event.target.value as Severity)
        setPreview(undefined)
        setError('')
      }}>
        <option value="low">Низкая</option>
        <option value="medium">Средняя</option>
        <option value="high">Высокая</option>
        <option value="critical">Критическая</option>
      </select></label>
      <button disabled={pending}>{pending ? 'Расчёт…' : 'Предпросмотр'}</button>
    </form>
    {preview && <p role="status" data-preview-branch={preview.branch}>
      Ветка «{preview.branch === 'yes' ? 'Да' : 'Нет'}» · {preview.wouldNotify ? 'Будет отправлено уведомление' : 'Уведомление не отправляется'}
    </p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
