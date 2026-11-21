import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orderGraph } from '../src/editor/layout.ts'

test('layout advances across edges, splits branches, and preserves the input', () => {
  const nodes = ['start', 'gate', 'yes', 'no'].map(id => ({ id, x: 5, y: 10 }))
  const edges = [
    { from: 'start', to: 'gate', branch: 'next' },
    { from: 'gate', to: 'yes', branch: 'yes' },
    { from: 'gate', to: 'no', branch: 'no' },
  ]
  const workflow = { nodes, edges }
  const result = orderGraph(workflow)
  assert.equal(result.edges, edges)
  assert.ok(result.nodes[0].x < result.nodes[1].x)
  assert.ok(result.nodes[1].x < result.nodes[2].x)
  assert.equal(result.nodes[2].x, result.nodes[3].x)
  assert.notEqual(result.nodes[2].y, result.nodes[3].y)
  assert.deepEqual(workflow.nodes.map(node => [node.x, node.y]), [[5, 10], [5, 10], [5, 10], [5, 10]])
  const cycle = { nodes, edges: [...edges, { from: 'yes', to: 'start', branch: 'next' }] }
  assert.equal(orderGraph(cycle), cycle)
})
