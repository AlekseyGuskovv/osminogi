import { useEffect, useState } from 'react'
import { getJson, postJson } from '../api'

type Catalog = {
  source: 'training' | 'osv' | 'custom'; analysisVersion: string; updating: boolean
  osvAvailable: boolean; customAvailable: boolean; error?: string
}
const path = '/advisory-catalog'

export function AdvisoryPanel() {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<Catalog>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    function load() {
      void getJson<Catalog>(path).then(value => {
        if (!active) return
        setError('')
        setCatalog(value)
        if (value.updating) timer = setTimeout(load, 1500)
      }).catch(reason => { if (active) setError(String(reason.message ?? reason)) })
    }
    load()
    return () => { active = false; clearTimeout(timer) }
  }, [open, catalog?.updating])

  async function update(action: 'source' | 'refresh', data: object) {
    setBusy(true)
    setError('')
    try { setCatalog(await postJson<Catalog>(`${path}/${action}`, data)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось обновить справочник.') }
    finally { setBusy(false) }
  }

  return <details className="garden-integration-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Справочник зависимостей</summary>
    {catalog && <div className="garden-integration-actions">
      <label>Источник<select value={catalog.source} disabled={busy || catalog.updating}
        onChange={event => void update('source', { source: event.target.value })}>
        <option value="training">Учебный</option>
        <option value="osv" disabled={!catalog.osvAvailable}>OSV</option>
        {catalog.customAvailable && <option value="custom">Подключённый файл</option>}
      </select></label>
      <button type="button" disabled={busy || catalog.updating} onClick={() => void update('refresh', {})}>Обновить OSV</button>
      <small>{catalog.updating ? 'Загружаем справочник…' : catalog.analysisVersion}</small>
    </div>}
    {!catalog && !error && open && <p role="status">Загружаем справочник…</p>}
    {(error || catalog?.error) && <p role="alert">{error || catalog?.error}</p>}
  </details>
}
