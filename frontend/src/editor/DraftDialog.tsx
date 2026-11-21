import { useRef, useState } from 'react'
import { postJson } from '../api'
import type { WorkflowDraft } from '../workflow'

export function DraftDialog({ onOpenDraft }: { onOpenDraft: (draft: WorkflowDraft) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<WorkflowDraft>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function generate() {
    if (!prompt.trim() || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setDraft(undefined)
    setError('')
    try {
      setDraft(await postJson<WorkflowDraft>('/workflows/draft', { prompt: prompt.trim() }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось подготовить черновик.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return <>
    <button onClick={() => dialog.current?.showModal()}>AI-черновик</button>
    <dialog className="garden-dialog" aria-labelledby="draft-heading" ref={dialog}>
      <h2 id="draft-heading">Новый сценарий по описанию</h2>
      <form className="garden-draft-form" onSubmit={event => { event.preventDefault(); void generate() }}>
        <label>Что нужно проверить?
          <textarea required rows={4} maxLength={1000} disabled={pending} value={prompt}
            onChange={event => { setPrompt(event.target.value); setDraft(undefined) }} />
        </label>
        <button disabled={pending || !prompt.trim()}>{pending ? 'Подготовка…' : 'Сгенерировать черновик'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {draft && <div>
        <p role="status">{draft.name} · {draft.nodes.length} блоков</p>
        <button onClick={() => { onOpenDraft(draft); dialog.current?.close(); setDraft(undefined); setPrompt('') }}>
          Открыть в редакторе
        </button>
      </div>}
      <form method="dialog"><button>Закрыть</button></form>
    </dialog>
  </>
}
