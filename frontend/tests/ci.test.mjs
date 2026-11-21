import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getHighlight } from '../src/runs/ci.ts'

test('getHighlight maps CI source, gate and the exact branch', () => {
  assert.deepEqual(getHighlight({ status: 'failed', nodeId: 'secret', gateNodeId: 'gate', branch: 'yes', findingId: 'F-key' }), {
    nodeIds: ['secret', 'gate'], edge: { from: 'gate', branch: 'yes' }, findingId: 'F-key',
  })
  assert.deepEqual(getHighlight({ status: 'error' }), { nodeIds: [], edge: undefined, findingId: undefined })
  assert.deepEqual(getHighlight({ status: 'passed', gateNodeId: 'gate', branch: 'no' }).nodeIds, ['gate'])
})
