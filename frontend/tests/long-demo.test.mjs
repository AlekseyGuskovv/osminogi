import test from 'node:test'
import assert from 'node:assert/strict'
import { longDemoLogs, longDemoWorkflow } from '../src/security-replay/longDemo.ts'
import { frameDuration, simulationEdge } from '../src/security-replay/playback.ts'

test('extended demo is one directed acyclic workflow spanning all eight node types', () => {
  const { nodes, edges } = longDemoWorkflow
  assert.equal(nodes.length, 12)
  assert.equal(edges.length, 12)
  assert.equal(nodes.filter(node => node.type === 'start').length, 1)
  assert.equal(new Set(nodes.map(node => node.type)).size, 8)
  assert.equal(new Set(nodes.map(node => node.id)).size, 12)
  const positions = new Map(nodes.map((node, index) => [node.id, index]))
  for (const edge of edges) assert.ok(positions.get(edge.from) < positions.get(edge.to))
  assert.deepEqual(edges.filter(edge => edge.from === 'demo-gate').map(({ branch, to }) => [branch, to]),
    [['yes', 'demo-telegram'], ['no', 'demo-finish']])
})

test('both local routes start at Start and move along only the selected branch', () => {
  for (const [variant, branch, ci, expected] of [['critical', 'yes', 'failed', 12], ['fixed', 'no', 'passed', 11]]) {
    const log = longDemoLogs[variant]
    assert.equal(log.source, 'simulation')
    const { events } = log
    const running = events.filter(event => event.type === 'node.status' && event.data.status === 'running')
    assert.equal(running.length, expected)
    assert.equal(running[0].data.nodeId, 'demo-start')
    assert.equal(running.at(-1).data.nodeId, 'demo-finish')
    const edges = events.flatMap((event, index) => simulationEdge(event, events[index + 1], longDemoWorkflow.edges) ?? [])
    assert.equal(edges.length, expected - 1)
    assert.deepEqual(edges.map(edge => edge.to), running.slice(1).map(event => event.data.nodeId))
    assert.equal(edges.find(edge => edge.from === 'demo-gate').branch, branch)
    const telegram = events.filter(event => event.data.nodeId === 'demo-telegram').map(event => event.data.status)
    assert.deepEqual(telegram, variant === 'critical' ? ['running', 'succeeded'] : ['skipped'])
    assert.equal(events.at(-1).data.ciStatus, ci)
    const duration = events.reduce((sum, event, index) => {
      const edge = simulationEdge(event, events[index + 1], longDemoWorkflow.edges)
      return sum + frameDuration(event, Boolean(edge), log.source)
    }, 0)
    assert.ok(duration >= 35000 && duration <= 45500)
  }
})
