import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyRunEvent } from '../src/runs/useRun.ts'
import { ciSummary, pulseFor } from '../src/security-replay/state.ts'

test('Pulse only animates a branch explicitly confirmed by SSE', () => {
  const before = { id: 'run-1', status: 'queued', nodes: {} }
  const yes = { from: 'gate', to: 'tg', branch: 'yes' }
  const no = { from: 'gate', to: 'finish', branch: 'no' }
  const event = (seq, type, data) => ({ runId: 'run-1', seq, at: '', type, data })
  const running = applyRunEvent(before, event(1, 'run.status', { status: 'running' }))
  const active = applyRunEvent(running, event(2, 'node.status', { nodeId: 'gate', status: 'running' }))
  assert.equal(pulseFor(yes, active).pulse, undefined)
  for (const [branch, edge, other] of [['yes', yes, no], ['no', no, yes]]) {
    const confirmed = applyRunEvent(active, event(3, 'node.status', { nodeId: 'gate', status: 'succeeded', output: { branch } }))
    assert.deepEqual(pulseFor(edge, confirmed), { choice: 'taken', pulse: 3 })
    assert.deepEqual(pulseFor(other, confirmed), { choice: 'alternate', pulse: undefined })
    assert.equal(confirmed.nodes.secret, undefined)
    const finished = applyRunEvent(confirmed, event(4, 'run.finished', { status: 'succeeded', ciStatus: 'failed' }))
    assert.equal(finished.ciStatus, 'failed')
    assert.deepEqual(pulseFor(edge, finished), { choice: 'taken', pulse: undefined })
  }
})

test('explanation distinguishes execution error from an evidenced critical finding', () => {
  assert.match(ciSummary({ ci: { status: 'error' } }), /ошибкой/)
  assert.doesNotMatch(ciSummary({ ci: { status: 'failed' } }), /критической/)
  assert.match(ciSummary({ ci: { status: 'failed', reason: 'CRITICAL_FOUND' } }), /критической/)
  assert.match(ciSummary({ ci: { status: 'passed', reason: 'NO_CRITICAL' } }), /нет/)
})
