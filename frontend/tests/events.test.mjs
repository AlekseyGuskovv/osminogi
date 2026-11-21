import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { subscribeRun } from '../src/runs/events.ts'

test('subscribeRun preserves ordering across reconnects and closes after final refresh', async t => {
  class TestSource {
    static CLOSED = 2
    constructor(url) { this.url = url; streams.push(this) }
    close() { this.readyState = TestSource.CLOSED }
    emit(payload) { this.onmessage({ data: JSON.stringify(payload) }) }
  }
  const streams = []
  const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  Object.defineProperty(globalThis, 'EventSource', { value: TestSource, configurable: true })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'EventSource', original)
    else delete globalThis.EventSource
  })
  const seen = []
  let finish
  const refresh = new Promise(resolve => { finish = resolve })
  const close = subscribeRun('run/1', async event => {
    seen.push(event.seq)
    if (event.type === 'run.finished') await refresh
  })
  assert.equal(streams[0].url, '/api/v1/runs/run%2F1/events')
  const stream = streams[0]
  const event = { runId: 'run/1', at: '2026-11-20T10:00:00Z', type: 'run.status', data: { status: 'running' } }
  stream.onmessage({ data: 'not json' })
  stream.emit({ ...event, seq: 1 })
  stream.onerror()
  stream.emit({ ...event, seq: 1 })
  stream.emit({ ...event, runId: 'foreign', seq: 99 })
  stream.emit({ ...event, seq: 2 })
  stream.emit({ ...event, seq: 3, type: 'run.finished', data: { status: 'succeeded', ciStatus: 'failed' } })
  stream.emit({ ...event, seq: 4 })
  await setImmediate()
  assert.deepEqual(seen, [1, 2, 3])
  assert.notEqual(stream.readyState, TestSource.CLOSED)
  finish()
  await setImmediate()
  assert.equal(stream.readyState, TestSource.CLOSED)
  close()
})
