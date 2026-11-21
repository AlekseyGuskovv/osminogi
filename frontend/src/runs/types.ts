import type { CiStatus, RunStatus } from './events'
import type { RunRequest } from './useRun'
import type { WorkflowDraft } from '../workflow'

export const severityLabels = { low: 'Низкая', medium: 'Средняя', high: 'Высокая', critical: 'Критическая' }

export type Finding = {
  id: string
  ruleId: string
  nodeId: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  path: string
  line: number
  evidence: string
  advisoryId: string | null
  category?: string | null
  group?: string | null
  artifact?: string | null
  version?: string | null
  advisoryAliases?: string[] | null
  fixedVersion?: string | null
  remediation?: string | null
}

export type Recommendation = {
  findingId: string
  source: 'ai' | 'rule'
  explanation: string
  action: string
}

export type Comparison = { introduced: string[]; existing: string[]; resolved: string[]; againstRunId?: string }
export type Delivery = 'sent' | 'failed' | 'skipped'
export type Ci = {
  status: CiStatus
  reason?: 'CRITICAL_FOUND' | 'NO_CRITICAL' | 'SCAN_FAILED' | 'NO_ANALYSIS' | 'PENDING'
  findingId?: string | null
  nodeId?: string | null
  gateNodeId?: string | null
  branch?: 'yes' | 'no' | null
}
export type Step = {
  nodeId: string
  status: RunStatus | 'skipped'
  branch?: 'yes' | 'no'
  input?: unknown
  output?: unknown
  error?: { code: string; message: string }
}

export type Run = RunRequest & {
  id: string
  workflowId: string
  workflowRevision: number
  createdAt?: string
  analysisVersion?: string
  catalogSource?: 'training' | 'organizer' | 'custom' | 'osv'
  graph?: Pick<WorkflowDraft, 'nodes' | 'edges'>
  fixableFindingIds?: string[]
  technicalErrors?: { stage: 'ai' | 'telegram' | 'analysis' | 'comparison'; code: string; message: string; nodeId?: string }[]
  status: RunStatus
  comparison: Comparison
  findings: Finding[]
  resolvedFindings?: Finding[]
  ci: Ci
  recommendations: Recommendation[]
  delivery: Delivery
  report: { summary: string; delivery: Delivery; messageId?: number }
  steps: Step[]
}
