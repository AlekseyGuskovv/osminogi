import { useRef, useState } from 'react'
import { ApiError, postJson } from '../api'
import { runsUrl } from './navigation'
import { useStartRun } from './useRun'
import type { Run } from './types'

type FixPreview = { previewId: string; path: string; before: string; after: string }

export function FixDialog({ run, findingId }: { run: Run; findingId: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [preview, setPreview] = useState<FixPreview>()
  const [snapshotId, setSnapshotId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { start, starting, accepted } = useStartRun()
  const path = `/runs/${encodeURIComponent(run.id)}`

  async function open() {
    dialog.current?.showModal()
    if (snapshotId) return
    setPreview(undefined)
    setSnapshotId('')
    setError('')
    setBusy(true)
    try {
      setPreview(await postJson<FixPreview>(`${path}/fix-preview`, { findingId }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось подготовить исправление.')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!preview || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await postJson<{ snapshotId: string }>(`${path}/apply-fix`, { previewId: preview.previewId })
      setSnapshotId(result.snapshotId)
    } catch (reason) {
      const stale = reason instanceof ApiError && reason.code === 'STALE_PREVIEW'
      if (stale) setPreview(undefined)
      setError(reason instanceof Error ? reason.message : 'Не удалось применить исправление.')
    } finally {
      setBusy(false)
    }
  }

  async function rerun() {
    if (accepted || !snapshotId) return
    setError('')
    try {
      await start(run.workflowId, { trigger: 'manual', snapshotId, baseSnapshotId: run.snapshotId })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось запустить повторную проверку.')
    }
  }

  return <>
    <button onClick={() => void open()}>Посмотреть учебное исправление</button>
    <dialog className="garden-dialog" ref={dialog} aria-labelledby="fix-heading">
      <h2 id="fix-heading">Учебное исправление</h2>
      {busy && <p role="status">Выполняется запрос…</p>}
      {error && <p role="alert">{error}</p>}
      {preview && <>
        <p><code>{preview.path}</code></p>
        <div className="garden-fix-diff">
          <div><h3>До</h3><pre>{preview.before}</pre></div>
          <div><h3>После</h3><pre>{preview.after}</pre></div>
        </div>
        {!snapshotId && <button className="garden-primary" disabled={busy} onClick={() => void apply()}>Применить исправление</button>}
      </>}
      {snapshotId && <p role="status" data-fixed-snapshot={snapshotId}>Создан снимок {snapshotId}.</p>}
      {snapshotId && !accepted && <button disabled={starting} onClick={() => void rerun()}>Проверить новый снимок</button>}
      {accepted && <p role="status"><a href={runsUrl(run.workflowId, accepted.id)}>Открыть запуск {accepted.id}</a> · В очереди</p>}
      <form className="garden-dialog-close" method="dialog"><button disabled={busy || starting}>Закрыть</button></form>
    </dialog>
  </>
}
