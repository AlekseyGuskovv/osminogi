import { FindingHistory } from './FindingHistory'
import { severityLabels } from './types'
import type { Finding, Recommendation } from './types'
import type { ReactNode } from 'react'

type FindingCardProps = { finding: Finding; recommendation?: Recommendation; workflowId?: string; variant?: 'compact' | 'resolved'; action?: ReactNode }

export function FindingCard({ finding, recommendation, workflowId, variant, action }: FindingCardProps) {
  const resolved = variant === 'resolved'
  const details = <>
    <pre className="garden-evidence" aria-label="Доказательство">{finding.evidence}</pre>
    {finding.fixedVersion && <p>Версия с исправлением: <code>{finding.fixedVersion}</code></p>}
    {recommendation && <section aria-label="Рекомендация">
      <p>{recommendation.explanation}</p>
      <p>{recommendation.action}</p>
      <small data-recommendation-source={recommendation.source}>
        {recommendation.source === 'rule' ? 'Источник · правило анализа' : 'Источник · AI'}
      </small>
    </section>}
    {!recommendation && finding.remediation && <p>{finding.remediation}</p>}
  </>
  return <article className="garden-finding" data-finding-id={finding.id} data-finding-variant={variant}>
    <header>
      <h3>{finding.title}</h3>
      {resolved ? <span className="evolution-resolved-badge">✓ Устранена</span>
        : <span className="garden-severity" data-severity={finding.severity}>{severityLabels[finding.severity]}</span>}
    </header>
    {resolved && <p className="evolution-history">Историческая критичность · {severityLabels[finding.severity]}</p>}
    <p className="garden-meta garden-finding-location">
      <code>{finding.path}:{finding.line}</code> · {finding.ruleId}{finding.advisoryId && ` · ${finding.advisoryId}`}
    </p>
    {variant ? <details><summary>Доказательство и подробности</summary>{details}</details> : details}
    {workflowId && <FindingHistory workflowId={workflowId} findingId={finding.id} />}
    {action}
  </article>
}
