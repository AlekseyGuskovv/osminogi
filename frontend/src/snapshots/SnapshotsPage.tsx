import { useEffect, useRef, useState } from 'react'
import { getJson, importSnapshot, postJson } from '../api'
import type { SnapshotRef } from '../api'
import { runsUrl } from '../runs/navigation'
import { useStartRun } from '../runs/useRun'
import { Icon } from '../ui/Icon'
import { StatusBadge } from '../ui/StatusBadge'
import { WorkspaceNav } from '../ui/WorkspaceNav'
import type { Workflow } from '../workflow'
import type { SnapshotComparison, SnapshotLibraryItem, SnapshotRun } from './types'
import './snapshots.css'

const dates = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
const fileChanges = { added: 'Добавлены', modified: 'Изменены', removed: 'Удалены' } as const

function dateLabel(value?: string | null) {
  const time = value ? Date.parse(value) : NaN
  return Number.isFinite(time) ? dates.format(time) : 'Дата загрузки неизвестна'
}

function snapshotPath(id: string) {
  return `/snapshots/${encodeURIComponent(id)}`
}

function errorMessage(cause: unknown, message: string) {
  return cause instanceof Error ? cause.message : message
}

function SnapshotDiff({ comparison }: { comparison: SnapshotComparison }) {
  const { files, dependencies, unresolvedBefore, unresolvedAfter } = comparison
  return <div className="snapshot-diff">
    <section className="snapshot-diff-section">
      <h3>Изменения в файлах снимков</h3>
      {Object.values(files).every(paths => paths.length === 0) && <p>Файлы совпадают.</p>}
      {(['added', 'modified', 'removed'] as const).map(key => files[key].length > 0 && <details key={key} open>
        <summary>{fileChanges[key]} <span>{files[key].length}</span></summary>
        <ul>{files[key].map(path => <li key={path}><code>{path}</code></li>)}</ul>
      </details>)}
    </section>
    <section className="snapshot-diff-section">
      <h3>Версии зависимостей Gradle</h3>
      {dependencies.length === 0 ? <p>Изменений в распознанных версиях нет.</p> : <div className="snapshot-table-wrap">
        <table aria-label="Изменения зависимостей">
          <thead><tr><th>Библиотека</th><th>В базовом</th><th>В выбранном</th></tr></thead>
          <tbody>{dependencies.map(item => <tr key={`${item.module}:${item.group}:${item.artifact}`}>
            <td><code>{item.group}:{item.artifact}</code><small>{item.module === '.' ? 'Корень проекта' : item.module}</small></td>
            <td>{item.before.join(', ') || '—'}</td>
            <td>{item.after.join(', ') || '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {(unresolvedBefore > 0 || unresolvedAfter > 0) && <p className="snapshot-coverage" role="status">
        Версию не удалось определить у {unresolvedBefore} объявлений в базовом снимке и у {unresolvedAfter} в выбранном.
      </p>}
    </section>
  </div>
}

function SnapshotWorkspace({ snapshot, library, workflows, initialWorkflowId, onRename }: {
  snapshot: SnapshotLibraryItem; library: SnapshotLibraryItem[]; workflows: Workflow[]
  initialWorkflowId: string; onRename: (snapshot: SnapshotRef) => void
}) {
  const [runs, setRuns] = useState<SnapshotRun[]>()
  const [runsError, setRunsError] = useState('')
  const [runsAttempt, setRunsAttempt] = useState(0)
  const [baseId, setBaseId] = useState('')
  const [comparison, setComparison] = useState<SnapshotComparison>()
  const [compareError, setCompareError] = useState('')
  const [comparing, setComparing] = useState(false)
  const [workflowId, setWorkflowId] = useState(workflows.find(workflow => workflow.id === initialWorkflowId)?.id ?? workflows[0]?.id ?? '')
  const [launchError, setLaunchError] = useState('')
  const { start, starting } = useStartRun()
  const [label, setLabel] = useState(snapshot.label)
  const [renameError, setRenameError] = useState('')
  const [renaming, setRenaming] = useState(false)
  const renameDialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    let active = true
    void getJson<SnapshotRun[]>(`${snapshotPath(snapshot.id)}/runs`).then(result => {
      if (active) setRuns(result)
    }).catch((cause: unknown) => {
      if (active) setRunsError(errorMessage(cause, 'Не удалось загрузить запуски снимка.'))
    })
    return () => { active = false }
  }, [snapshot.id, runsAttempt])

  async function rename() {
    if (renaming || !label.trim()) return
    setRenaming(true)
    setRenameError('')
    try {
      onRename(await postJson<SnapshotRef>(`${snapshotPath(snapshot.id)}/rename`, { label: label.trim() }))
      renameDialog.current?.close()
    } catch (cause) {
      setRenameError(errorMessage(cause, 'Не удалось сохранить имя снимка.'))
    } finally {
      setRenaming(false)
    }
  }

  async function compare() {
    if (!baseId || comparing) return
    setComparing(true)
    setComparison(undefined)
    setCompareError('')
    setLaunchError('')
    try {
      const query = new URLSearchParams({ againstSnapshotId: baseId })
      setComparison(await getJson<SnapshotComparison>(`${snapshotPath(snapshot.id)}/comparison?${query}`))
    } catch (cause) {
      setCompareError(errorMessage(cause, 'Не удалось сравнить снимки.'))
    } finally {
      setComparing(false)
    }
  }

  async function launch() {
    if (!comparison || !workflowId || starting) return
    setLaunchError('')
    try {
      const run = await start(workflowId, { trigger: 'manual', snapshotId: snapshot.id, baseSnapshotId: comparison.baseSnapshotId })
      if (run) window.location.assign(runsUrl(workflowId, run.id))
    } catch (cause) {
      setLaunchError(errorMessage(cause, 'Не удалось запустить проверку.'))
    }
  }

  return <section className="snapshot-workspace" aria-label="Выбранный снимок">
    <header className="snapshot-detail-heading">
      <div><h2>{snapshot.label}</h2><p className="garden-meta">
        {dateLabel(snapshot.createdAt)}{snapshot.fileCount !== undefined && ` · Файлов: ${snapshot.fileCount}`}
      </p></div>
      <button onClick={() => {
        setLabel(snapshot.label)
        setRenameError('')
        renameDialog.current?.showModal()
      }}>Переименовать</button>
    </header>
    <section className="snapshot-panel">
      <h2>Сравнение версий</h2>
      {library.length < 2 ? <p>Загрузите ещё один снимок, чтобы сравнить версии.</p> :
        <form className="snapshot-controls" onSubmit={event => { event.preventDefault(); void compare() }}>
          <label>Базовый снимок<select value={baseId} disabled={comparing || starting} onChange={event => {
            setBaseId(event.target.value)
            setComparison(undefined)
            setCompareError('')
            setLaunchError('')
          }}>
            <option value="">Выбрать предыдущую версию</option>
            {library.filter(item => item.id !== snapshot.id).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label>
          <button disabled={!baseId || comparing || starting}>{comparing ? 'Сравнение…' : 'Сравнить'}</button>
        </form>}
      {compareError && <p role="alert">{compareError}</p>}
      {comparison && <>
        <SnapshotDiff comparison={comparison} />
        {workflows.length > 0 ? <form className="snapshot-controls snapshot-launch" onSubmit={event => {
          event.preventDefault(); void launch()
        }}>
          <label>Сценарий проверки<select value={workflowId} onChange={event => setWorkflowId(event.target.value)} disabled={starting}>
            {workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
          </select></label>
          <button className="garden-primary" disabled={!workflowId || starting}>{starting ? 'Запуск…' : 'Проверить новую версию'}</button>
        </form> : <a className="garden-subtle-action snapshot-launch" href="?workflow=new">Создать сценарий для проверки</a>}
        {launchError && <p role="alert">{launchError}</p>}
      </>}
    </section>
    <section className="snapshot-panel">
      <h2>Запуски с этим снимком</h2>
      {runsError && <><p role="alert">{runsError}</p><button onClick={() => {
        setRunsError(''); setRunsAttempt(value => value + 1)
      }}>Повторить</button></>}
      {!runs && !runsError && <p role="status">Загрузка запусков…</p>}
      {runs?.length === 0 && <p>Снимок ещё не использовали в проверках.</p>}
      {runs && runs.length > 0 && <ul className="snapshot-runs">
        {runs.map(run => <li key={run.id}>
          <a href={runsUrl(run.workflowId ?? initialWorkflowId, run.id)}>
            {workflows.find(workflow => workflow.id === run.workflowId)?.name ?? 'Открыть запуск'}
            {run.createdAt && <small>{dateLabel(run.createdAt)}</small>}
          </a>
          {run.role === 'base' && <span className="garden-meta">База сравнения</span>}
          {run.status === 'succeeded' ? <StatusBadge kind="ci" status={run.ci} /> : <StatusBadge kind="run" status={run.status} />}
        </li>)}
      </ul>}
    </section>
    <dialog className="garden-dialog" ref={renameDialog} aria-labelledby="snapshot-rename-title"
      onCancel={event => { if (renaming) event.preventDefault() }}>
      <h2 id="snapshot-rename-title">Переименовать снимок</h2>
      <form className="snapshot-rename" onSubmit={event => { event.preventDefault(); void rename() }}>
        <label>Название<input value={label} onChange={event => setLabel(event.target.value)} maxLength={160} required disabled={renaming} /></label>
        {renameError && <p role="alert">{renameError}</p>}
        <div><button type="button" disabled={renaming} onClick={() => renameDialog.current?.close()}>Отмена</button>
          <button className="garden-primary" disabled={renaming || !label.trim() || label.trim() === snapshot.label}>
            {renaming ? 'Сохранение…' : 'Сохранить'}</button></div>
      </form>
    </dialog>
  </section>
}

export function SnapshotsPage({ initialWorkflowId }: { initialWorkflowId: string }) {
  const [library, setLibrary] = useState<SnapshotLibraryItem[]>()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const selected = library?.find(item => item.id === selectedId) ?? library?.[0]

  useEffect(() => {
    let active = true
    void Promise.all([getJson<SnapshotLibraryItem[]>('/snapshots/library'), getJson<Workflow[]>('/workflows')])
      .then(([items, scenarioList]) => {
        if (!active) return
        setLibrary(items)
        setWorkflows(scenarioList)
      }).catch((cause: unknown) => {
        if (active) setLoadError(errorMessage(cause, 'Не удалось загрузить снимки.'))
      })
    return () => { active = false }
  }, [attempt])

  async function upload(file: File) {
    if (uploading) return
    setUploading(true)
    setUploadError('')
    try {
      const snapshot = await importSnapshot(file)
      setLibrary(current => [{ ...snapshot, runCount: 0, latestRun: null }, ...(current ?? [])])
      setSelectedId(snapshot.id)
    } catch (cause) {
      setUploadError(errorMessage(cause, 'Не удалось загрузить архив.'))
    } finally {
      setUploading(false)
    }
  }

  return <div className="garden-shell">
    <WorkspaceNav workflowId={initialWorkflowId} section="snapshots" />
    <main className="garden">
      <section className="garden-results snapshots-page">
        <div className="garden-page-heading snapshots-page-heading"><h1>Снимки</h1>
          <button className="garden-primary snapshots-upload" onClick={() => fileInput.current?.click()} disabled={uploading || !library}>
            <Icon name="upload" size={15} />{uploading ? 'Загрузка…' : 'Загрузить ZIP'}
          </button>
        </div>
        <input type="file" ref={fileInput} accept=".zip,application/zip" hidden onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void upload(file)
        }} />
        {uploadError && <p role="alert">{uploadError}</p>}
        {loadError && <><p role="alert">{loadError}</p><button onClick={() => {
          setLoadError(''); setAttempt(value => value + 1)
        }}>Повторить</button></>}
        {!loadError && !library && <p role="status">Загрузка снимков…</p>}
        {library?.length === 0 && <section className="snapshot-panel snapshots-empty">
          <Icon name="snapshots" size={24} /><h2>Загрузите первую версию проекта</h2>
          <p>Снимки из конструктора тоже появятся здесь.</p>
        </section>}
        {selected && library && <div className="snapshots-layout">
          <aside className="snapshot-library" aria-label="Библиотека снимков">
            <h2>Версии проекта <span>{library.length}</span></h2>
            <ul>{library.map(item => <li key={item.id}>
              <button aria-pressed={item.id === selected.id} onClick={() => setSelectedId(item.id)}>
                <Icon name="snapshots" /><span className="snapshot-library-item">
                  <strong>{item.label}</strong>
                  <small>{dateLabel(item.createdAt)}</small>
                  <small>{item.runCount > 0 ? `Запусков: ${item.runCount}` : 'Проверок пока нет'}</small>
                  {item.latestRun && (item.latestRun.status === 'succeeded'
                    ? <StatusBadge kind="ci" status={item.latestRun.ci} /> : <StatusBadge kind="run" status={item.latestRun.status} />)}
                </span>
              </button>
            </li>)}</ul>
          </aside>
          <SnapshotWorkspace key={selected.id} snapshot={selected} library={library} workflows={workflows}
            initialWorkflowId={initialWorkflowId} onRename={renamed => setLibrary(current => current?.map(item =>
              item.id === renamed.id ? { ...item, ...renamed } : item))} />
        </div>}
      </section>
    </main>
  </div>
}
