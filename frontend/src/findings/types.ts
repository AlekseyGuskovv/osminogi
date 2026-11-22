import type { Finding, Recommendation } from '../runs/types'

export type FindingReviewStatus = 'unreviewed' | 'in_progress' | 'false_positive'
export type FindingReview = {
  findingId: string
  status: FindingReviewStatus
  reason: string
  updatedAt: string
}

export type FindingRecord = {
  finding: Finding
  category: string
  state: 'open' | 'resolved' | 'unverified'
  firstSeenAt: string | null
  lastSeenAt: string | null
  lastSeenRunId: string
  occurrences: number
  recommendation: Recommendation | null
  review: FindingReview | null
}

export type FindingsOverview = { latestRunId: string | null; findings: FindingRecord[] }
