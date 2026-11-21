import { useEffect, useRef, useState } from 'react'
import { getJson, postJson } from '../api'
import { runsUrl } from '../runs/navigation'
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

  function copy(id: string) {
    void request(async () => {
      const workflow = await postJson<Workflow>(`/templates/${encodeURIComponent(id)}/copy`, {})
      window.location.assign(`?${new URLSearchParams({ workflow: workflow.id })}`)
    })
  }

  return <main className="garden">
    <header className="garden-top"><span className="garden-brand"><b aria-hidden="true">✳</b> Cyber Garden</span>
      <a href={`?workflow=${encodeURIComponent(workflowId)}`}>Редактор</a>
      <a href={runsUrl(workflowId)}>Запуски</a>
    </header>
    <section className="garden-results">
      <h1>Шаблоны</h1>
      {!templates && !error && <p role="status">Загрузка шаблонов…</p>}
      {error && <><p role="alert">{error}</p>
        {!templates && <button onClick={() => { setError(''); setAttempt(value => value + 1) }}>Повторить</button>}
      </>}
      {templates && <>
        {templates.length === 0 && <p>В каталоге пока нет шаблонов.</p>}
        <div className="garden-findings">
          {templates.map(template => <article className="garden-finding" key={template.id} data-template-id={template.id}>
            <h2>{template.name}</h2><p>{template.description}</p>
            <p className="garden-meta">{template.workflow.nodes.length} блоков · ревизия {template.workflow.revision}</p>
            <button disabled={pending} onClick={() => copy(template.id)}>Создать копию</button>
          </article>)}
        </div>
        <form className="garden-template-form" onSubmit={event => { event.preventDefault(); publish() }}>
          <h2>Опубликовать сценарий</h2>
          <label>Сценарий<select value={selectedWorkflow} onChange={event => setSelectedWorkflow(event.target.value)}>
            {workflows.map(workflow => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}
          </select></label>
          <label>Название<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Описание<textarea maxLength={500} rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <button disabled={!selectedWorkflow || !name.trim() || pending}>Опубликовать</button>
        </form>
      </>}
    </section>
  </main>
}
