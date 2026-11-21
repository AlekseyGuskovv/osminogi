import { useRef, useState } from 'react'
import { importSnapshot } from '../api'
import type { SnapshotRef } from '../api'

type SnapshotPickerProps = {
  snapshots: SnapshotRef[]
  value: string
  disabled: boolean
  onSelect: (id: string) => void
  onImport: (snapshot: SnapshotRef) => void
}

export function SnapshotPicker({ snapshots, value, disabled, onSelect, onImport }: SnapshotPickerProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function upload(file: File) {
    if (inFlight.current) return
    inFlight.current = true
    setUploading(true)
    setError('')
    setSuccess('')
    try {
      const snapshot = await importSnapshot(file)
      onImport(snapshot)
      onSelect(snapshot.id)
      setSuccess(`Снимок «${snapshot.label}» выбран.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить ZIP.')
    } finally {
      inFlight.current = false
      setUploading(false)
    }
  }

  return <div className="garden-snapshot-picker">
    <label>Снимок<select className="garden-snapshot-select" value={value} disabled={disabled || uploading}
      onChange={event => { setSuccess(''); setError(''); onSelect(event.target.value) }}>
      <option value="">Выберите снимок</option>
      {snapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{snapshot.label}</option>)}
    </select></label>
    <input type="file" accept=".zip,application/zip" hidden ref={fileInput} aria-label="Архив учебного проекта"
      onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void upload(file)
      }} />
    <button type="button" disabled={disabled || uploading} onClick={() => fileInput.current?.click()}>
      {uploading ? 'Загрузка…' : 'Загрузить ZIP'}
    </button>
    {error && <small role="alert">{error}</small>}
    {success && <small role="status">{success}</small>}
  </div>
}
