import { useRef, useState } from 'react'
import { postJson } from '../api'
import type { WorkflowDraftResult } from '../workflow'

export function DraftDialog({ onOpenDraft, disabled }: { onOpenDraft: (result: WorkflowDraftResult) => void; disabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<WorkflowDraftResult>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function generate() {
    if (!prompt.trim() || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setDraft(undefined)
    setError('')
    try {
      setDraft(await postJson<WorkflowDraftResult>('/workflows/draft', { prompt: prompt.trim() }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось подготовить черновик.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  function showDraft(result: WorkflowDraftResult) {
    onOpenDraft(result)
    dialog.current?.close()
    setDraft(undefined)
    setPrompt('')
  }

  return <>
    <button disabled={disabled} onClick={() => dialog.current?.showModal()}>AI-черновик</button>
    <dialog className="garden-dialog" aria-labelledby="draft-heading" ref={dialog}>
      <h2 id="draft-heading">Новый сценарий по описанию</h2>
      <form className="garden-draft-form" onSubmit={event => { event.preventDefault(); void generate() }}>
        <label>Что нужно проверить?
          <textarea required rows={4} maxLength={1000} disabled={pending} value={prompt}
            onChange={event => { setPrompt(event.target.value); setDraft(undefined) }} />
        </label>
        <button className={draft ? undefined : "garden-primary"} disabled={pending || !prompt.trim()}>{pending ? 'Подготовка…' : 'Сгенерировать черновик'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {draft && <div>
        <p role="status">{draft.name} · {draft.nodes.length} блоков</p>
        {draft.warnings?.length > 0 && <ul className="garden-draft-warnings" aria-label="Предупреждения">
          {draft.warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>}
        <button className="garden-primary" onClick={() => showDraft(draft)}>
          Открыть в редакторе
        </button>
      </div>}
      <form className="garden-dialog-close" method="dialog"><button>Закрыть</button></form>
    </dialog>
  </>
}
