import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeOutcome } from '../src/runs/outcome.ts'

const finished = { status: 'succeeded', ci: { status: 'passed' }, findings: [], steps: [], delivery: 'skipped' }

test('run outcome reports critical findings even when the workflow executed successfully', () => {
  const result = summarizeOutcome({ ...finished, ci: { status: 'failed' }, findings: [
    { title: 'Проблема зависимости', severity: 'critical', path: 'build.gradle.kts', line: 8, advisoryId: 'DEMO-1' },
  ] })
  assert.equal(result.tone, 'danger')
  assert.deepEqual(result.issues, [{ title: 'Проблема зависимости', detail: 'build.gradle.kts:8 · DEMO-1' }])
})

test('run outcome separates an incomplete analysis from integration errors', () => {
  assert.equal(summarizeOutcome(finished).tone, 'success')
  assert.equal(summarizeOutcome({ ...finished, ci: { status: 'error', reason: 'NO_ANALYSIS' } }).tone, 'warning')
  const failure = { stage: 'ai', message: 'Модель недоступна.', nodeId: 'ai' }
  const warning = summarizeOutcome({ ...finished, technicalErrors: [failure], steps: [
    { nodeId: 'ai', status: 'failed', error: { message: failure.message } },
  ] })
  assert.equal(warning.tone, 'warning')
  assert.equal(warning.issues.length, 1)
  const error = summarizeOutcome({ ...finished, status: 'failed', ci: { status: 'error' }, steps: [
    { nodeId: 'sca', status: 'failed', error: { message: 'Не удалось проверить зависимости.' } },
  ] })
  assert.equal(error.tone, 'error')
  assert.equal(error.issues[0].detail, 'Не удалось проверить зависимости.')
})
