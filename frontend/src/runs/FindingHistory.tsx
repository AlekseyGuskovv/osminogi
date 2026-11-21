import { useState } from 'react'
import { getJson } from '../api'
import { runsUrl } from './navigation'

type Entry = { runId: string; state: 'found' | 'resolved' | 'returned' }
type History = { findingId: string; entries: Entry[] }
const labels = { found: 'Найдена', resolved: 'Устранена', returned: 'Вернулась' }

export function FindingHistory({ workflowId, findingId }: { workflowId: string; findingId: string }) {
  const [history, setHistory] = useState<History>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    if (history || loading) return
    setLoading(true)
    setError('')
    try {
      const path = `/workflows/${encodeURIComponent(workflowId)}/findings/${encodeURIComponent(findingId)}/history`
      setHistory(await getJson<History>(path))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'История находки недоступна.')
    } finally {
      setLoading(false)
    }
  }

  return <details onToggle={event => { if (event.currentTarget.open) void load() }}>
    <summary>История находки</summary>
    {loading && <p role="status">Загрузка истории…</p>}
    {error && <><p role="alert">{error}</p><button onClick={() => void load()}>Повторить</button></>}
    {history?.entries.length === 0 && <p>Изменений пока нет.</p>}
    {history && <ol className="garden-finding-history">
      {history.entries.map(entry => <li key={entry.runId} data-finding-state={entry.state}>
        {labels[entry.state]} · <a href={runsUrl(workflowId, entry.runId)}>{entry.runId}</a>
      </li>)}
    </ol>}
  </details>
}
