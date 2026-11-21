import type { SnapshotRef } from '../api'
import type { CiStatus, RunStatus } from '../runs/events'

export type SnapshotRun = {
  id: string
  workflowId: string | null
  createdAt: string | null
  status: RunStatus
  ci: CiStatus
  role: 'current' | 'base'
}

export type SnapshotLibraryItem = SnapshotRef & { runCount: number; latestRun: SnapshotRun | null }

export type SnapshotComparison = {
  baseSnapshotId: string
  snapshotId: string
  files: { added: string[]; modified: string[]; removed: string[] }
  dependencies: { module: string; group: string; artifact: string; before: string[]; after: string[] }[]
  unresolvedBefore: number
  unresolvedAfter: number
}
