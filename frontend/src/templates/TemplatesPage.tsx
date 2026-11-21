import { useEffect, useRef, useState } from 'react'
import { apiUrl, getJson, importTemplateYaml, postJson } from '../api'
import { Icon } from '../ui/Icon'
import { WorkspaceNav } from '../ui/WorkspaceNav'
import type { Workflow } from '../workflow'
import type { Template } from './types'

export function TemplatesPage({ workflowId, sharedTemplateId }: { workflowId: string; sharedTemplateId?: string }) {
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
  const upload = useRef<HTMLInputElement>(null)
  const shareDialog = useRef<HTMLDialogElement>(null)
  const shareField = useRef<HTMLInputElement>(null)
  const [publishing, setPublishing] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [shareStatus, setShareStatus] = useState('')

  function showPublishForm() {
    setError('')
    setPublishing(true)
    dialog.current?.showModal()
  }

  useEffect(() => {
    let active = true
    const catalog = sharedTemplateId
      ? getJson<Template>('/templates/' + encodeURIComponent(sharedTemplateId)).then(template => [template])
      : getJson<Template[]>('/templates')
    void Promise.all([catalog, getJson<Workflow[]>('/workflows')])
      .then(([catalog, available]) => {
        if (!active) return
        setTemplates(catalog)
        setWorkflows(available)
        setSelectedWorkflow(available.find(workflow => workflow.id === workflowId)?.id ?? available[0]?.id ?? '')
      }).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить шаблоны.')
      })
    return () => { active = false }
  }, [workflowId, sharedTemplateId, attempt])

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

  function importYaml(file: File) {
    void request(async () => {
      const workflow = await importTemplateYaml<Workflow>(file)
      window.location.assign('?' + new URLSearchParams({ workflow: workflow.id, setup: '1' }))
    })
  }

  function showShare(templateId: string) {
    const url = new URL(window.location.href)
    url.search = new URLSearchParams({ view: 'templates', template: templateId }).toString()
    url.hash = ''
    setShareUrl(url.href)
    setShareStatus('')
    shareDialog.current?.showModal()
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareStatus('Ссылка скопирована.')
    } catch {
      shareField.current?.select()
      setShareStatus('Скопируйте выделенную ссылку вручную.')
    }
  }

  return <div className="garden-shell">
    <WorkspaceNav workflowId={workflowId} section="templates" />
    <main className="garden">
    <section className="garden-results">
      <p className="garden-kicker">Рабочее пространство <span>/</span> Каталог</p>
      <div className="garden-page-heading"><h1>{sharedTemplateId ? 'Шаблон по ссылке' : 'Шаблоны сценариев'}</h1>
        <div className="garden-template-actions">
          {sharedTemplateId && <a href="?view=templates">Все шаблоны</a>}
          <button disabled={pending} onClick={() => upload.current?.click()}>Импортировать YAML</button>
          {!sharedTemplateId && templates && templates.length > 0 &&
            <button className="garden-primary" onClick={showPublishForm}>Опубликовать шаблон</button>}
        </div>
      </div>
      <input hidden ref={upload} type="file" accept=".yml,.yaml,application/yaml,text/yaml"
        onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) importYaml(file)
        }} />
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
        {templates.map(template => <article className="garden-finding" key={template.id} data-template-id={template.id}>
          <span className="garden-template-icon"><Icon name="templates" /></span>
          <h2>{template.name}</h2>{template.description && <p>{template.description}</p>}
          <p className="garden-meta">Блоков: {template.workflow.nodes.length} · Ревизия {template.workflow.revision}</p>
          <div className="garden-template-actions">
            <button disabled={pending} onClick={() => openCopiedTemplate(template.id)}>Создать копию</button>
            <a href={apiUrl('/templates/' + encodeURIComponent(template.id) + '/yaml')} download="cyber-garden-template.yml">Скачать YAML</a>
            <button onClick={() => showShare(template.id)}>Поделиться ссылкой</button>
          </div>
        </article>)}
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
      <dialog className="garden-dialog" ref={shareDialog} aria-labelledby="share-template-title">
        <h2 id="share-template-title">Поделиться шаблоном</h2>
        <p>Получателю нужен доступ к этому экземпляру Cyber Garden.</p>
        <label className="garden-template-link">Ссылка на шаблон
          <input ref={shareField} value={shareUrl} readOnly onFocus={event => event.target.select()} />
        </label>
        {shareStatus && <p role="status">{shareStatus}</p>}
        <form method="dialog" className="garden-template-dialog-actions">
          <button type="button" className="garden-primary" onClick={() => void copyShareLink()}>Копировать ссылку</button>
          <button>Закрыть</button>
        </form>
      </dialog>
    </section>
    </main>
  </div>
}
