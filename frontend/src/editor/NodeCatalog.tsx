import { useRef, useState } from 'react'
import { getJson, postJson } from '../api'
import type { WorkflowDraft } from '../workflow'

type Draft = Pick<WorkflowDraft['nodes'][number], 'type' | 'settings'> & { name: string; description: string }
type Template = Draft & { id: string }

export function NodeCatalog({ disabled, onInsert }: {
  disabled: boolean; onInsert: (template: Template) => boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [selected, setSelected] = useState('')
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<Draft>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function request(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Операция не удалась.') }
    finally { setBusy(false) }
  }

  return <>
    <button type="button" disabled={disabled} onClick={() => {
      dialog.current?.showModal()
      void request(async () => setTemplates(await getJson<Template[]>('/node-templates')))
    }}>Каталог AI-нод</button>
    <dialog className="garden-dialog garden-integration-dialog" ref={dialog} aria-labelledby="node-catalog-title">
      <h2 id="node-catalog-title">Каталог AI-нод</h2>
      <p>Опишите задачу, сохраните результат и добавьте блок в сценарий.</p>
      {templates.length > 0 && <div className="garden-integration-actions">
        <select aria-label="Сохранённый блок" value={selected} onChange={event => setSelected(event.target.value)}>
          <option value="">Выберите сохранённый блок</option>
          {templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="button" disabled={busy || !selected} onClick={() => {
          const item = templates.find(template => template.id === selected)
          if (item && onInsert(item)) dialog.current?.close()
          else setError('Не удалось добавить блок. Проверьте, открыт ли граф и есть ли в нём уже блок запуска.')
        }}>Добавить на граф</button>
      </div>}
      <label>Что должен делать блок?
        <textarea rows={3} maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)}
          placeholder="Например, проверить, есть ли хотя бы три находки" />
      </label>
      <button className="garden-primary" type="button" disabled={busy || !prompt.trim()} onClick={() => void request(async () => {
        setDraft(undefined)
        setDraft(await postJson<Draft>('/node-templates/draft', { prompt }))
      })}>Сгенерировать ноду</button>
      {draft && <div className="garden-integration-fields">
        <label>Название<input value={draft.name} maxLength={80} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Описание<textarea rows={2} maxLength={300} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        <button type="button" disabled={busy || !draft.name.trim()} onClick={() => void request(async () => {
          const item = await postJson<Template>('/node-templates', draft)
          setTemplates(items => [...items, item])
          setSelected(item.id)
          setDraft(undefined)
        })}>Сохранить в каталог</button>
      </div>}
      {busy && <p role="status">Ждём ответ сервера…</p>}
      {error && <p role="alert">{error}</p>}
      <form className="garden-dialog-close" method="dialog"><button>Закрыть</button></form>
    </dialog>
  </>
}
