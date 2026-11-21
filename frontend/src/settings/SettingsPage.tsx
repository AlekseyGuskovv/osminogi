import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { apiUrl, getJson, postJson } from '../api'
import { Icon } from '../ui/Icon'
import { WorkspaceNav } from '../ui/WorkspaceNav'
import type { ConnectionRef } from '../workflow'
import './settings.css'

type Catalog = {
  source: 'training' | 'osv' | 'custom'; analysisVersion: string; updating: boolean
  osvAvailable: boolean; customAvailable: boolean; osvUpdatedAt?: string | null; error?: string | null
  refreshIntervalHours: number; nextRefreshAt: string | null
}
type AiDiagnostics = {
  mode: 'auto' | 'codex' | 'ollama' | 'custom'; checking: boolean
  providers: { id: string; name: string; model: string | null; status: 'unknown' | 'available' | 'unavailable'
    checkedAt?: string; message?: string | null }[]
}
type StorageUsage = { databaseBytes: number; snapshotCount: number; snapshotBytes: number; runCount: number; runBytes: number }

const catalogPath = '/advisory-catalog'
const aiPath = '/settings/ai'
const catalogPoll = (catalog: Catalog) => catalog.updating ? 1200 : catalog.refreshIntervalHours ? 15000 : 0
const aiPoll = (ai: AiDiagnostics) => ai.checking ? 1200 : 0

function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}

function dateLabel(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU')
}

function useResource<T>(path: string, poll?: (value: T) => number) {
  const [value, setValue] = useState<T>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const result = await getJson<T>(path)
        if (!active) return
        setValue(result)
        setError('')
        const delay = poll?.(result)
        if (delay) timer = setTimeout(() => void load(), delay)
      } catch (cause) {
        if (active) setError(message(cause, 'Не удалось загрузить настройки.'))
      }
    }
    void load()
    return () => { active = false; clearTimeout(timer) }
  }, [path, poll, attempt])
  return { value, setValue, error, reload: () => { setError(''); setAttempt(value => value + 1) } }
}

function SettingsCard({ id, title, icon, children }: { id: string; title: string; icon: 'sca' | 'telegram' | 'ai' | 'snapshots'; children: ReactNode }) {
  return <section className="settings-card" id={id} aria-labelledby={`${id}-heading`}>
    <header><Icon name={icon} size={19} /><h2 id={`${id}-heading`}>{title}</h2></header>
    {children}
  </section>
}

function ResourceMessage({ ready, error, retry }: { ready: boolean; error: string; retry: () => void }) {
  if (error) return <div className="settings-feedback"><p role="alert">{error}</p><button onClick={retry}>Повторить</button></div>
  return ready ? null : <p role="status">Загрузка…</p>
}

function CatalogSettings() {
  const resource = useResource<Catalog>(catalogPath, catalogPoll)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const catalog = resource.value

  async function update(path: string, body: object) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await postJson<Catalog>(`${catalogPath}/${path}`, body)
      resource.setValue(result)
      resource.reload()
    } catch (cause) {
      setError(message(cause, 'Не удалось обновить настройки справочника.'))
    } finally {
      setBusy(false)
    }
  }

  return <SettingsCard id="catalog" icon="sca" title="Справочник уязвимостей">
    <ResourceMessage ready={Boolean(catalog)} error={resource.error} retry={resource.reload} />
    {catalog && <>
      <div className="settings-fields">
        <label>Источник<select value={catalog.source} disabled={busy} onChange={event => void update('source', { source: event.target.value })}>
          <option value="training">Учебный справочник</option>
          <option value="osv" disabled={!catalog.osvAvailable}>OSV Maven</option>
          {catalog.customAvailable && <option value="custom">Подключённый файл</option>}
        </select></label>
        <label>Автообновление OSV<select value={catalog.refreshIntervalHours} disabled={busy}
          onChange={event => void update('schedule', { refreshIntervalHours: Number(event.target.value) })}>
          <option value={0}>Вручную</option><option value={24}>Ежедневно</option><option value={168}>Еженедельно</option>
        </select></label>
      </div>
      <dl className="settings-facts"><div><dt>OSV обновлён</dt><dd>{dateLabel(catalog.osvUpdatedAt)}</dd></div>
        {catalog.nextRefreshAt && <div><dt>Следующее обновление</dt><dd>{dateLabel(catalog.nextRefreshAt)}</dd></div>}
        <div><dt>Версия базы</dt><dd><code title={catalog.analysisVersion}>{catalog.analysisVersion}</code></dd></div>
      </dl>
      <button disabled={busy || catalog.updating} onClick={() => void update('refresh', {})}>
        {catalog.updating ? 'Обновляем OSV…' : 'Обновить OSV'}
      </button>
      {(error || catalog.error) && <p role="alert">{error || catalog.error}</p>}
    </>}
  </SettingsCard>
}

function TelegramSettings() {
  const resource = useResource<ConnectionRef[]>('/connections')
  const [editing, setEditing] = useState<ConnectionRef>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const route = (id: string, operation: 'edit' | 'test') => `/connections/${encodeURIComponent(id)}/${operation}`

  function showForm(item?: ConnectionRef) {
    setEditing(item)
    setFormError('')
    form.current?.reset()
    dialog.current?.showModal()
  }

  function replace(item: ConnectionRef) {
    resource.setValue(current => current?.some(member => member.id === item.id)
      ? current.map(member => member.id === item.id ? item : member) : [...(current ?? []), item])
  }

  async function save(element: HTMLFormElement) {
    if (busy) return
    setBusy(true)
    setFormError('')
    const data = new FormData(element)
    const name = String(data.get('name') ?? '').trim()
    const chatId = String(data.get('chatId') ?? '').trim()
    const token = String(data.get('token') ?? '').trim()
    try {
      const credentials = chatId || token || !editing ? { chatId, token } : {}
      const item = editing
        ? await postJson<ConnectionRef>(route(editing.id, 'edit'), { name, ...credentials })
        : await postJson<ConnectionRef>('/connections', { type: 'telegram', name, ...credentials })
      replace(item)
      setNotice('Подключение сохранено.')
      setError('')
      element.reset()
      dialog.current?.close()
    } catch (cause) {
      setFormError(message(cause, 'Не удалось сохранить подключение.'))
    } finally {
      setBusy(false)
    }
  }

  async function connectionAction(item: ConnectionRef, operation: 'edit' | 'test') {
    if (busy) return
    setBusy(true)
    setNotice('')
    setError('')
    try {
      if (operation === 'test') {
        const result = await postJson<{ messageId: number }>(route(item.id, 'test'), {})
        setNotice(`«${item.name}» · сообщение № ${result.messageId} доставлено.`)
      } else {
        replace(await postJson<ConnectionRef>(route(item.id, 'edit'), { configured: !item.configured }))
      }
    } catch (cause) {
      setError(message(cause, 'Не удалось выполнить действие с подключением.'))
    } finally {
      setBusy(false)
    }
  }

  return <SettingsCard id="telegram" icon="telegram" title="Telegram">
    <ResourceMessage ready={Boolean(resource.value)} error={resource.error} retry={resource.reload} />
    {resource.value?.length === 0 && <p>Добавь чат, чтобы получать результаты проверок.</p>}
    {resource.value && resource.value.length > 0 && <ul className="settings-items">
      {resource.value.map(item => <li key={item.id}>
        <div><strong>{item.name}</strong><small>{item.id === 'telegram-env' ? 'Подключение сервера' : item.configured ? 'Включено' : 'Отключено'}</small></div>
        <div className="settings-actions">
          <button disabled={busy || !item.configured} onClick={() => void connectionAction(item, 'test')}>Отправить тест</button>
          {item.id !== 'telegram-env' && <>
            <button disabled={busy} onClick={() => showForm(item)}>Изменить</button>
            <button disabled={busy} onClick={() => void connectionAction(item, 'edit')}>{item.configured ? 'Отключить' : 'Включить'}</button>
          </>}
        </div>
      </li>)}
    </ul>}
    <button className="garden-primary" disabled={busy || !resource.value} onClick={() => showForm()}>Добавить подключение</button>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    <dialog className="garden-dialog" ref={dialog} aria-labelledby="telegram-form-title" onClose={() => form.current?.reset()} onCancel={event => {
      if (busy) event.preventDefault()
    }}>
      <h2 id="telegram-form-title">{editing ? 'Изменить подключение' : 'Добавить подключение'}</h2>
      <form key={editing?.id ?? 'new'} className="settings-form" ref={form} onSubmit={event => { event.preventDefault(); void save(event.currentTarget) }}>
        <label>Название<input name="name" defaultValue={editing?.name} required maxLength={100} disabled={busy} /></label>
        <label>Chat ID<input name="chatId" autoComplete="off" required={!editing} maxLength={21} disabled={busy} /></label>
        <label>Токен бота<input name="token" type="password" autoComplete="new-password" maxLength={150} required={!editing} disabled={busy} /></label>
        {editing && <p>Укажи Chat ID и токен, если хочешь обновить данные подключения.</p>}
        {formError && <p role="alert">{formError}</p>}
        <div className="settings-actions"><button type="button" disabled={busy} onClick={() => {
          form.current?.reset(); dialog.current?.close()
        }}>Отмена</button>
          <button className="garden-primary" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button></div>
      </form>
    </dialog>
  </SettingsCard>
}

function AiSettings() {
  const resource = useResource<AiDiagnostics>(aiPath, aiPoll)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const ai = resource.value
  const labels = { unknown: 'Ожидает проверки', available: 'Доступен', unavailable: 'Недоступен' }

  async function check() {
    if (starting || ai?.checking) return
    setStarting(true)
    setError('')
    try {
      resource.setValue(await postJson<AiDiagnostics>(`${aiPath}/test`, {}))
      resource.reload()
    } catch (cause) {
      setError(message(cause, 'Не удалось проверить AI.'))
    } finally {
      setStarting(false)
    }
  }

  return <SettingsCard id="ai" icon="ai" title="AI">
    <ResourceMessage ready={Boolean(ai)} error={resource.error} retry={resource.reload} />
    {ai && <>
      <ul className="settings-items settings-ai">{ai.providers.map((provider, index) => <li key={provider.id}>
        <div><strong>{provider.name}{ai.mode === 'auto' && <small>{index === 0 ? 'Основной' : 'Резервный'}</small>}</strong>
          <small>{provider.model ?? 'Модель задаётся на стороне провайдера'}</small>
          {provider.message && <p>{provider.message}</p>}
          {provider.checkedAt && <small>{dateLabel(provider.checkedAt)}</small>}
        </div>
        <span className="settings-ai-status" data-status={provider.status}>{labels[provider.status]}</span>
      </li>)}</ul>
      <button disabled={starting || ai.checking} onClick={() => void check()}>{ai.checking || starting ? 'Проверяем подключение…' : 'Проверить подключение'}</button>
      {error && <p role="alert">{error}</p>}
    </>}
  </SettingsCard>
}

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`
  const kilo = bytes / 1024
  const value = kilo < 1024 ? kilo : kilo / 1024
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${kilo < 1024 ? 'КБ' : 'МБ'}`
}

function StorageSettings() {
  const resource = useResource<StorageUsage>('/settings/storage')
  const storage = resource.value
  return <SettingsCard id="storage" icon="snapshots" title="Обслуживание данных">
    <ResourceMessage ready={Boolean(storage)} error={resource.error} retry={resource.reload} />
    {storage && <dl className="settings-facts">
      <div><dt>Размер базы на диске</dt><dd>{sizeLabel(storage.databaseBytes)}</dd></div>
      <div><dt>Снимки</dt><dd>{storage.snapshotCount} · {sizeLabel(storage.snapshotBytes)}</dd></div>
      <div><dt>История запусков</dt><dd>{storage.runCount} · {sizeLabel(storage.runBytes)}</dd></div>
    </dl>}
    <a className="garden-subtle-action" href={apiUrl('/settings/storage/backup')} download="cyber-garden.sqlite3">
      <Icon name="snapshots" size={15} />Скачать резервную копию SQLite
    </a>
    <p>Копия содержит снимки и результаты проверок. Для переноса подключений Telegram сохрани исходный ключ шифрования отдельно.</p>
  </SettingsCard>
}

export function SettingsPage({ workflowId }: { workflowId: string }) {
  return <div className="garden-shell">
    <WorkspaceNav workflowId={workflowId} section="settings" />
    <main className="garden">
      <section className="garden-results settings-page">
        <div className="garden-page-heading"><h1>Настройки</h1></div>
        <div className="settings-grid"><CatalogSettings /><TelegramSettings /><AiSettings /><StorageSettings /></div>
      </section>
    </main>
  </div>
}
