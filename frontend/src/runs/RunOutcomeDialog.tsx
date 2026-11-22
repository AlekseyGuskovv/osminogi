import { useEffect, useId, useRef } from 'react'
import { Icon } from '../ui/Icon'
import { summarizeOutcome } from './outcome'
import type { Run } from './types'
import './run-outcome.css'

export function RunOutcomeDialog({ run, reportHref, onBeforeOpen }: {
  run: Run; reportHref?: string; onBeforeOpen?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const shown = useRef(false)
  const titleId = useId()
  const descriptionId = useId()
  const { tone, title, summary, issues } = summarizeOutcome(run)
  const visible = issues.slice(0, 3)

  useEffect(() => {
    if (shown.current || !dialog.current) return
    onBeforeOpen?.()
    dialog.current.showModal()
    shown.current = true
  }, [onBeforeOpen])

  return <dialog className="garden-dialog run-outcome" ref={dialog} aria-labelledby={titleId}
    aria-describedby={descriptionId} data-outcome={tone} onKeyDown={event => {
      if (event.key === 'Escape') event.stopPropagation()
    }}>
    <header><span className="run-outcome-icon"><Icon name={tone === 'success' ? 'finish' : 'alert'} size={22} /></span>
      <h2 id={titleId}>{title}</h2></header>
    <p id={descriptionId}>{summary}</p>
    {run.findings.length > 0 && <p className="garden-meta">Находок: {run.findings.length}</p>}
    {visible.length > 0 && <ul className="run-outcome-issues">
      {visible.map((item, index) => <li key={`${item.title}-${index}`}>
        <strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}
      </li>)}
      {issues.length > visible.length && <li className="garden-meta">Ещё {issues.length - visible.length} в отчёте</li>}
    </ul>}
    <form className="garden-dialog-close" method="dialog">
      {reportHref && <a className="garden-subtle-action" href={reportHref}>Открыть отчёт</a>}
      <button className="garden-primary">Закрыть</button>
    </form>
  </dialog>
}
