import type { CiStatus, RunStatus } from './events'
import type { RunRequest } from './useRun'

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
  reason?: 'CRITICAL_FOUND' | 'NO_CRITICAL' | 'SCAN_FAILED'
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
  status: RunStatus
  comparison: Comparison
  findings: Finding[]
  ci: Ci
  recommendations: Recommendation[]
  delivery: Delivery
  report: { summary: string; delivery: Delivery }
  steps: Step[]
}
