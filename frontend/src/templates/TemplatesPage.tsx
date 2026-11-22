import { PrismGlassCard } from '../ui/PrismGlassCard'
import { useEffect, useRef, useState } from 'react'
import { getJson, postJson } from '../api'
import { Icon } from '../ui/Icon'
import { WorkspaceNav } from '../ui/WorkspaceNav'
import type { Workflow } from '../workflow'
import type { Template } from './types'

export function TemplatesPage({ workflowId }: { workflowId: string }) {
  const [templates, setTemplates] = useState<Template[]>()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedWorkflow, setSelectedWorkflow] = useState(workflowId)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const inFlight = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const [publishing, setPublishing] = useState(false)

  function showPublishForm() {
    setError('')
    setPublishing(true)
    dialog.current?.showModal()
  }

  useEffect(() => {
    let active = true
    void Promise.all([getJson<Template[]>('/templates'), getJson<Workflow[]>('/workflows')])
      .then(([catalog, available]) => {
        if (!active) return
        setTemplates(catalog)
        setWorkflows(available)
        setSelectedWorkflow(available.find(workflow => workflow.id === workflowId)?.id ?? available[0]?.id ?? '')
      }).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить шаблоны.')
      })
    return () => { active = false }
  }, [workflowId, attempt])

  async function request(action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось выполнить запрос.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  function publish() {
    if (!selectedWorkflow || !name.trim()) return
    void request(async () => {
      const template = await postJson<Template>('/templates', { workflowId: selectedWorkflow, name: name.trim(), description })
      setTemplates(current => [...(current ?? []), template])
      setName('')
      setDescription('')
      dialog.current?.close()
    })
  }

  function openCopiedTemplate(templateId: string) {
    void request(async () => {
      const workflow = await postJson<Workflow>(`/templates/${encodeURIComponent(templateId)}/copy`, {})
      window.location.assign(`?${new URLSearchParams({ workflow: workflow.id, setup: '1' })}`)
    })
  }

  return <div className="garden-shell">
    <WorkspaceNav workflowId={workflowId} section="templates" />
    <main className="garden">
    <section className="garden-results">
      <p className="garden-kicker">Рабочее пространство <span>/</span> Каталог</p>
      <div className="garden-page-heading"><h1>Шаблоны сценариев</h1>
        {templates && templates.length > 0 && <button className="garden-primary" onClick={showPublishForm}>Опубликовать шаблон</button>}
      </div>
      {!templates && !error && <p role="status">Загрузка шаблонов…</p>}
      {error && !publishing && <><p role="alert">{error}</p>
        {!templates && <button onClick={() => { setError(''); setAttempt(value => value + 1) }}>Повторить</button>}
      </>}
      {templates && templates.length === 0 && <section className="garden-template-empty">
        <span className="garden-template-icon"><Icon name="templates" size={23} /></span>
        <h2>Здесь появятся ваши шаблоны</h2>
        <p>Публикуйте готовые сценарии, чтобы команда могла использовать их как основу для своих проверок.</p>
        <button className="garden-primary" disabled={!workflows.length} onClick={showPublishForm}>Опубликовать первый шаблон</button>
      </section>}
      {templates && <div className="garden-findings garden-template-grid">
        {templates.map(template => <PrismGlassCard as="article" variant="elevated" accent="aqua" interactive className="garden-finding" key={template.id} data-template-id={template.id}>
          <span className="garden-template-icon"><Icon name="templates" /></span>
          <h2>{template.name}</h2>{template.description && <p>{template.description}</p>}
          <p className="garden-meta">Блоков: {template.workflow.nodes.length} · Ревизия {template.workflow.revision}</p>
          <button disabled={pending} onClick={() => openCopiedTemplate(template.id)}>Создать копию</button>
        </PrismGlassCard>)}
      </div>}
      <dialog className="garden-dialog" ref={dialog} aria-labelledby="publish-template-title" onClose={() => setPublishing(false)}
        onCancel={event => { if (pending) event.preventDefault() }}>
        <h2 id="publish-template-title">Опубликовать шаблон</h2>
        <form className="garden-template-form" onSubmit={event => { event.preventDefault(); publish() }}>
          <label>Сценарий<select value={selectedWorkflow} onChange={event => setSelectedWorkflow(event.target.value)}>
            {workflows.map(workflow => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}
          </select></label>
          <label>Название<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Описание<textarea maxLength={500} rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
          {error && <p role="alert">{error}</p>}
          <div className="garden-template-dialog-actions">
            <button type="button" disabled={pending} onClick={() => dialog.current?.close()}>Отмена</button>
            <button className="garden-primary" disabled={!selectedWorkflow || !name.trim() || pending}>{pending ? 'Публикация…' : 'Опубликовать'}</button>
          </div>
        </form>
      </dialog>
    </section>
    </main>
  </div>
}
