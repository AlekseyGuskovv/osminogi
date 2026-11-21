import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyRunEvent } from '../src/runs/useRun.ts'

test('applyRunEvent merges a block update without replacing neighboring data', () => {
  const view = {
    id: 'run-1', status: 'running',
    nodes: { secret: { status: 'running', input: { snapshotId: 'pr-1' } }, gate: { status: 'queued' } },
  }
  const event = {
    runId: 'run-1', seq: 3, at: '2026-11-20T10:00:00Z', type: 'node.status',
    data: { nodeId: 'secret', status: 'succeeded', output: { findingIds: ['F-key'] } },
  }
  const next = applyRunEvent(view, event)
  assert.deepEqual(next.nodes.secret, { ...view.nodes.secret, status: 'succeeded', output: { findingIds: ['F-key'] } })
  assert.equal(next.nodes.gate, view.nodes.gate)
  assert.equal(view.nodes.secret.status, 'running')
  assert.equal(applyRunEvent(next, { ...event, runId: 'foreign' }), next)
  assert.deepEqual(applyRunEvent(next, { ...event, type: 'run.finished', data: { status: 'succeeded', ciStatus: 'failed' } }),
    { ...next, status: 'succeeded', ciStatus: 'failed' })
})
