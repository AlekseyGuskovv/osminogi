import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addNode } from '../src/editor/graph.ts'

test('addNode allocates unique IDs and preserves workflow metadata and inputs', () => {
  const draft = { id: 'wf-1', revision: 3, name: 'Проверка', schedule: null, nodes: [], edges: [] }
  const first = addNode(draft, 'secrets', { x: 10, y: 40 })
  const second = addNode(first, 'secrets', { x: 90, y: 120 })
  assert.deepEqual(second.nodes, [
    { id: 'secrets-1', type: 'secrets', x: 10, y: 40, settings: {} },
    { id: 'secrets-2', type: 'secrets', x: 90, y: 120, settings: {} },
  ])
  assert.equal(second.revision, 3)
  assert.equal(draft.nodes.length, 0)
  assert.equal(first.nodes.length, 1)
  assert.equal(second.edges, draft.edges)
})

test('condition defaults are independent for each new node', () => {
  const draft = { name: 'Проверка', schedule: null, nodes: [], edges: [] }
  const first = addNode(draft, 'condition', { x: 0, y: 0 })
  const second = addNode(first, 'condition', { x: 5, y: 5 })
  assert.deepEqual(second.nodes[1].settings, { metric: 'maxSeverity', operator: 'gte', value: 'critical' })
  assert.notEqual(first.nodes[0].settings, second.nodes[1].settings)
})
