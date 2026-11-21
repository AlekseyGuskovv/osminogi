import assert from 'node:assert/strict'
import test from 'node:test'
import { reconstructRoute } from '../src/security-replay/reconstruction.ts'
import { simulationEdge } from '../src/security-replay/playback.ts'

const types = ['start', 'secrets', 'sca', 'sast', 'ai', 'condition', 'telegram', 'finish']
const workflow = {
  nodes: types.map(type => ({ id: type, type })),
  edges: [
    ...types.slice(0, 5).map((from, index) => ({ from, to: types[index + 1], branch: 'next' })),
    { from: 'condition', to: 'telegram', branch: 'yes' },
    { from: 'condition', to: 'finish', branch: 'no' },
  ],
}

test('reconstructed routes start at Start and classify intermediate nodes independently from saved steps', () => {
  for (const [branch, target, ci] of [['yes', 'telegram', 'failed'], ['no', 'finish', 'passed']]) {
    const run = { id: branch, status: 'succeeded', ci: { status: ci, gateNodeId: 'condition', branch },
      steps: [{ nodeId: 'secrets', status: 'succeeded' }, { nodeId: 'condition', status: 'succeeded', branch },
        { nodeId: 'telegram', status: branch === 'no' ? 'skipped' : 'succeeded' }] }
    const { events, reconstructed, source } = reconstructRoute(workflow, run)
    assert.equal(source, 'reconstruction')
    assert.deepEqual(events.filter(event => event.data.status === 'running' && event.data.nodeId).map(event => event.data.nodeId),
      [...types.slice(0, 6), target])
    assert.ok(reconstructed.has('sca'))
    assert.ok(!reconstructed.has('secrets'))
    const routes = events.flatMap((event, index) => simulationEdge(event, events[index + 1], workflow.edges) ?? [])
    assert.equal(routes.at(-1).branch, branch)
    assert.equal(events.at(-1).data.ciStatus, ci)
  }
})

test('reconstruction stops on confirmed failure without fabricating a branch', () => {
  const run = { id: 'error', status: 'failed', ci: { status: 'error' },
    steps: [{ nodeId: 'secrets', status: 'failed' }] }
  const { events } = reconstructRoute(workflow, run)
  assert.equal(events.at(-1).data.ciStatus, 'error')
  assert.ok(!events.some(event => event.data.nodeId === 'condition'))
})
