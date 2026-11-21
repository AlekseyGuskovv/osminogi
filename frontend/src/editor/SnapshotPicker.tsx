import { useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { importSnapshot, postJson } from '../api'
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

  async function upload(load: () => Promise<SnapshotRef>) {
    if (inFlight.current) return
    inFlight.current = true
    setUploading(true)
    setError('')
    setSuccess('')
    try {
      const snapshot = await load()
      onImport(snapshot)
      onSelect(snapshot.id)
      setSuccess(`Снимок «${snapshot.label}» выбран.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось импортировать проект.')
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
        if (file) void upload(() => importSnapshot(file))
      }} />
    <button className="garden-upload" type="button" disabled={disabled || uploading} onClick={() => fileInput.current?.click()}>
      <Icon name="upload" size={14} />{uploading ? 'Загрузка…' : 'Загрузить ZIP'}
    </button>
    <button className="garden-upload" type="button" disabled={disabled || uploading}
      onClick={() => void upload(() => postJson<SnapshotRef>('/snapshots/import-repository', {
        url: 'https://github.com/TBagirov/training',
      }))}>Проект организаторов</button>
    {error && <small role="alert">{error}</small>}
    {success && <small role="status">{success}</small>}
  </div>
}
