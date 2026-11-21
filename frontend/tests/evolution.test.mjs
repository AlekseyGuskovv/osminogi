import assert from 'node:assert/strict'
import test from 'node:test'
import { criticalCount, evolutionResult, resolvedIds } from '../src/security-replay/evolution.ts'

const key = { id: 'F-key', severity: 'critical' }
const dependency = { id: 'F-dep', severity: 'high' }
const before = { id: 'run-1', findings: [key, dependency], ci: { status: 'failed', reason: 'CRITICAL_FOUND' } }
const after = { id: 'run-2', findings: [dependency], ci: { status: 'passed' } }

test('resolved findings require the comparison against the selected earlier run', () => {
  assert.deepEqual(resolvedIds(after, { resolved: [] }), [])
  assert.deepEqual(resolvedIds(after, { resolved: ['F-key', 'F-key', 'F-dep'] }), ['F-key'])
  assert.equal(criticalCount(before), 1)
  assert.equal(criticalCount(after), 0)
  const resolved = resolvedIds(after, { resolved: ['F-key'] })
  assert.match(evolutionResult(before, after, resolved, 'after').detail, /F-key.*CI пройден/)
  assert.equal(evolutionResult(before, after, resolved, 'before').title, 'CI не пройден')
})

test('failed, errored and worsening checks do not announce successful remediation', () => {
  assert.equal(evolutionResult(before, { ...after, ci: before.ci }, ['F-key'], 'after').title, 'CI не пройден')
  assert.equal(evolutionResult(before, { ...after, ci: { status: 'error' } }, ['F-key'], 'after').title, 'Ошибка анализа')
  assert.equal(evolutionResult(before, { ...after, findings: [key, { ...key, id: 'new' }] }, [], 'after').title, 'Критических рисков стало больше')
})
