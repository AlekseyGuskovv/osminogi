import { useState } from 'react'
import { FindingCard } from '../runs/FindingCard'
import type { NodeType } from '../workflow'
import type { Run } from '../runs/types'
import { ciSummary } from './state'

const analyzerLabels: Partial<Record<NodeType, string>> = { secrets: 'Secrets', sca: 'SCA', sast: 'SAST', ai: 'AI' }
const severity = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const steps = ['Анализатор', 'Находка', 'Условие', 'Решение CI']

export function ExplainableCI({ run, onFocus, onClose, initialStep = 3, analyzerType, graphHref }: {
  run: Run
  onFocus?: (id: string) => void
  onClose?: () => void
  initialStep?: 0 | 3
  analyzerType?: NodeType
  graphHref?: string
}) {
  const [step, setStep] = useState<number>(initialStep)
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
      {step === 0 && <p>{run.ci.nodeId ? <>Анализатор {analyzerType && analyzerLabels[analyzerType]} <code>{run.ci.nodeId}</code> указан в решении CI.</> : 'CI не указал конкретный анализатор.'}</p>}
      {step === 1 && <p>{finding ? <><code>{finding.id}</code> · {severity[finding.severity]} · {finding.title}</> : 'В решении CI нет доступной связанной находки.'}</p>}
      {step === 2 && <p>{run.ci.gateNodeId ? <>Условие <code>{run.ci.gateNodeId}</code>{run.ci.branch && <> выбрало ветвь <strong>{run.ci.branch.toUpperCase()}</strong></>}.</> : 'В решении CI не указано конкретное условие.'}</p>}
      {step === 3 && <p><strong>CI {run.ci.status.toUpperCase()}</strong>{run.ci.reason && <> · <code>{run.ci.reason}</code></>}. {ciSummary(run)}{finding && <> Связанная находка <code>{finding.id}</code>.</>}</p>}
    </div>
    <div className="replay-controls">
      <button disabled={step === 0} onClick={() => setStep(step - 1)}>Назад</button>
      <button disabled={step === 3} onClick={() => setStep(step + 1)}>Далее</button>
      {graphHref && <a href={graphHref}>Открыть объяснение на графе</a>}
      {focus && onFocus && <button onClick={() => onFocus(focus)}>Блок на графе</button>}
      {finding && <button aria-expanded={showFinding} onClick={() => setShowFinding(value => !value)}>{showFinding ? 'Скрыть находку' : 'Открыть находку'}</button>}
    </div>
    {showFinding && finding && <FindingCard finding={finding} workflowId={run.workflowId}
      recommendation={run.recommendations.find(item => item.findingId === finding.id)} />}
  </section>
}
