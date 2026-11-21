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
      <div className="garden-page-heading"><h1>Шаблоны сценариев</h1></div>
      {!templates && !error && <p role="status">Загрузка шаблонов…</p>}
      {error && <><p role="alert">{error}</p>
        {!templates && <button onClick={() => { setError(''); setAttempt(value => value + 1) }}>Повторить</button>}
      </>}
      {templates && <div className="garden-template-layout">
        <section aria-label="Каталог шаблонов">
        {templates.length === 0 && <p>В каталоге пока нет шаблонов.</p>}
        <div className="garden-findings garden-template-grid">
          {templates.map(template => <article className="garden-finding" key={template.id} data-template-id={template.id}>
            <span className="garden-template-icon"><Icon name="templates" /></span><h2>{template.name}</h2><p>{template.description}</p>
            <p className="garden-meta">{template.workflow.nodes.length} блоков · ревизия {template.workflow.revision}</p>
            <button disabled={pending} onClick={() => openCopiedTemplate(template.id)}>Создать копию</button>
          </article>)}
        </div>
        </section>
        <form className="garden-template-form" onSubmit={event => { event.preventDefault(); publish() }}>
          <h2>Опубликовать сценарий</h2>
          <label>Сценарий<select value={selectedWorkflow} onChange={event => setSelectedWorkflow(event.target.value)}>
            {workflows.map(workflow => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}
          </select></label>
          <label>Название<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Описание<textarea maxLength={500} rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <button disabled={!selectedWorkflow || !name.trim() || pending}>Опубликовать</button>
        </form>
      </div>}
    </section>
    </main>
  </div>
}
