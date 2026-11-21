import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceTime, emptyReplay, frameDuration, frameProgress, historyLimit, activationDuration, recordEvent } from '../src/security-replay/playback.ts'

const node = (seq, status = 'running', runId = 'run-1') => ({
  runId, seq, at: '', type: 'node.status', data: { nodeId: 'analyzer', status },
})

test('virtual time retains its position across speed changes, pause and resume', () => {
  let elapsed = advanceTime(0, 600, 1, false)
  assert.equal(elapsed, 600)
  elapsed = advanceTime(elapsed, 400, 0.5, false)
  assert.equal(elapsed, 800)
  elapsed = advanceTime(elapsed, 5000, 2, true)
  assert.equal(elapsed, 800)
  assert.equal(advanceTime(elapsed, 300, 2, false), 1400)
})

test('travel, arrival and tail share the same visual timeline', () => {
  assert.equal(frameDuration(node(1, 'succeeded'), true), 2050)
  assert.equal(frameProgress(550, true).travel, 0)
  assert.equal(frameProgress(1175, true).travel, 0.5)
  assert.equal(frameProgress(1800, true).arrival, 1)
  assert.equal(frameProgress(2050, true).trail, 0)
  assert.equal(frameProgress(1175, false).trail, 0)
})

test('history deduplicates sequence numbers, scopes runs and keeps a bounded checkpoint', () => {
  let log = recordEvent(emptyReplay('run-1'), node(1, 'succeeded'))
  assert.equal(recordEvent(log, node(1)), log)
  assert.equal(recordEvent(log, node(2, 'running', 'run-2')), log)
  for (let seq = 2; seq <= historyLimit + 1; seq++) log = recordEvent(log, node(seq))
  assert.equal(log.events.length, historyLimit)
  assert.equal(log.offset, 1)
  assert.equal(log.base.nodes.analyzer.status, 'succeeded')
  assert.equal(log.events[0].seq, 2)
})

test('a running frame allows the node activation without changing edge timing', () => {
  assert.equal(frameDuration(node(1), false), activationDuration)
  assert.equal(activationDuration, 1800)
  assert.equal(frameDuration(node(2, 'succeeded'), true), 2050)
  assert.equal(frameDuration(node(3, 'skipped'), false), 0)
})
