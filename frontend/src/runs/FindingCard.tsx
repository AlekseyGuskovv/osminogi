import { FindingHistory } from './FindingHistory'
import type { Finding, Recommendation } from './types'

type FindingCardProps = { finding: Finding; recommendation?: Recommendation; workflowId?: string }

const severityLabels = { low: 'Низкая', medium: 'Средняя', high: 'Высокая', critical: 'Критическая' }

export function FindingCard({ finding, recommendation, workflowId }: FindingCardProps) {
  return <article className="garden-finding" data-finding-id={finding.id}>
    <header>
      <h3>{finding.title}</h3>
      <span className="garden-severity" data-severity={finding.severity}>{severityLabels[finding.severity]}</span>
    </header>
    <p className="garden-meta">
      <code>{finding.path}:{finding.line}</code> · {finding.ruleId}{finding.advisoryId && ` · ${finding.advisoryId}`}
    </p>
    <pre aria-label="Доказательство">{finding.evidence}</pre>
    {recommendation && <section aria-label="Рекомендация">
      <p>{recommendation.explanation}</p>
      <p>{recommendation.action}</p>
      <small data-recommendation-source={recommendation.source}>
        {recommendation.source === 'rule' ? 'Источник · правило анализа' : 'Источник · AI'}
      </small>
    </section>}
    {workflowId && <FindingHistory workflowId={workflowId} findingId={finding.id} />}
  </article>
}
