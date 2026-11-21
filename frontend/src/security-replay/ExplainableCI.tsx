import { useState } from 'react'
import { FindingCard } from '../runs/FindingCard'
import type { Run } from '../runs/types'
import { ciSummary } from './state'

const steps = ['Анализатор', 'Находка', 'Условие', 'Решение CI']

export function ExplainableCI({ run, onFocus, onClose }: {
  run: Run
  onFocus?: (id: string) => void
  onClose?: () => void
}) {
  const [step, setStep] = useState(3)
  const [showFinding, setShowFinding] = useState(false)
  const finding = run.findings.find(item => item.id === run.ci.findingId)
  const focus = [run.ci.nodeId, finding?.nodeId, run.ci.gateNodeId][step]

  return <section className="replay-panel" aria-label="Объяснение CI">
    <header><div><p className="replay-kicker">EXPLAINABLE CI · {run.id}</p><h2>{ciSummary(run)}</h2></div>
      {onClose && <button type="button" onClick={onClose}>Закрыть</button>}
    </header>
    <nav aria-label="Шаги объяснения">{steps.map((label, index) =>
      <button key={label} aria-pressed={index === step} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</nav>
    <div className="replay-step">
      {step === 0 && <p>{run.ci.nodeId ? <>Анализатор <code>{run.ci.nodeId}</code> указан в решении CI.</> : 'CI не указал конкретный анализатор.'}</p>}
      {step === 1 && <p>{finding ? <><code>{finding.id}</code> · {finding.title}</> : 'В решении CI нет доступной связанной находки.'}</p>}
      {step === 2 && <p>{run.ci.gateNodeId ? <>Условие <code>{run.ci.gateNodeId}</code>{run.ci.branch && <> выбрало ветвь <strong>{run.ci.branch.toUpperCase()}</strong></>}.</> : 'В решении CI не указано конкретное условие.'}</p>}
      {step === 3 && <p><strong>{ciSummary(run)}</strong>{finding && <> Связанная находка <code>{finding.id}</code>.</>}</p>}
    </div>
    <div className="replay-controls">
      <button disabled={step === 0} onClick={() => setStep(step - 1)}>Назад</button>
      <button disabled={step === 3} onClick={() => setStep(step + 1)}>Далее</button>
      {focus && onFocus && <button onClick={() => onFocus(focus)}>Блок на графе</button>}
      {finding && <button aria-expanded={showFinding} onClick={() => setShowFinding(value => !value)}>{showFinding ? 'Скрыть находку' : 'Открыть находку'}</button>}
    </div>
    {showFinding && finding && <FindingCard finding={finding} workflowId={run.workflowId}
      recommendation={run.recommendations.find(item => item.findingId === finding.id)} />}
  </section>
}
