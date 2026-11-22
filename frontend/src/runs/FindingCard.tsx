import { PrismGlassCard } from '../ui/PrismGlassCard'
import { PrismIcon } from '../ui/Icon'
import { FindingHistory } from './FindingHistory'
import type { Finding, Recommendation } from './types'
import type { ReactNode } from 'react'

type FindingCardProps = { finding: Finding; recommendation?: Recommendation; workflowId?: string; variant?: 'compact' | 'resolved'; action?: ReactNode }

const severityLabels = { low: 'Низкая', medium: 'Средняя', high: 'Высокая', critical: 'Критическая' }

export function FindingCard({ finding, recommendation, workflowId, variant, action }: FindingCardProps) {
  const resolved = variant === 'resolved'
  const details = <>
    <pre className="garden-evidence" aria-label="Доказательство">{finding.evidence}</pre>
    {recommendation && <PrismGlassCard as="section" className="prism-recommendation" accent="violet" aria-label="Рекомендация">
      <p>{recommendation.explanation}</p>
      <p>{recommendation.action}</p>
      <small data-recommendation-source={recommendation.source}>
        {recommendation.source === 'rule' ? 'Источник · правило анализа' : 'Источник · AI'}
      </small>
    </PrismGlassCard>}
  </>
  return <PrismGlassCard as="article" className="garden-finding" variant={resolved ? "elevated" : "subtle"} accent={resolved ? "mint" : "neutral"} interactive={Boolean(variant || workflowId || action)} data-finding-id={finding.id} data-finding-variant={variant}>
    <header>
      <h3>{finding.title}</h3>
      {resolved ? <span className="evolution-resolved-badge"><PrismIcon name="check" size={13} /> Устранена</span>
        : <span className="garden-severity" data-severity={finding.severity}>{severityLabels[finding.severity]}</span>}
    </header>
    {resolved && <p className="evolution-history">Историческая критичность · {severityLabels[finding.severity]}</p>}
    <p className="garden-meta garden-finding-location">
      <code>{finding.path}:{finding.line}</code> · {finding.ruleId}{finding.advisoryId && ` · ${finding.advisoryId}`}
    </p>
    {variant ? <details><summary>Доказательство и подробности</summary>{details}</details> : details}
    {workflowId && <FindingHistory workflowId={workflowId} findingId={finding.id} />}
    {action}
  </PrismGlassCard>
}
