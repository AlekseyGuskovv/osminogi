import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addNode, connect } from '../src/editor/graph.ts'

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

function connectionDraft() {
  return {
    name: 'Проверка',
    schedule: null,
    nodes: [
      ['start', 'start'], ['gate', 'condition'], ['scan', 'sast'], ['end', 'finish'],
    ].map(([id, type]) => ({ id, type, x: 0, y: 0, settings: {} })),
    edges: [
      { from: 'start', to: 'gate', branch: 'next' },
      { from: 'gate', to: 'scan', branch: 'yes' },
      { from: 'gate', to: 'end', branch: 'no' },
      { from: 'scan', to: 'end', branch: 'next' },
    ],
  }
}

test('connect changes only the matching branch and accepts a shared target', () => {
  const draft = connectionDraft()
  const replacement = { from: 'gate', to: 'end', branch: 'yes' }
  const next = connect(draft, replacement)
  assert.deepEqual(next.edges, [draft.edges[0], draft.edges[2], draft.edges[3], replacement])
  assert.equal(draft.edges[1].to, 'scan')
  assert.equal(connect(next, replacement), next)
})

test('connect rejects invalid branches, endpoints and cycles', () => {
  const draft = connectionDraft()
  for (const edge of [
    { from: 'scan', to: 'gate', branch: 'next' },
    { from: 'scan', to: 'start', branch: 'next' },
    { from: 'scan', to: 'scan', branch: 'next' },
    { from: 'scan', to: 'end', branch: 'yes' },
    { from: 'gate', to: 'end', branch: 'next' },
    { from: 'end', to: 'scan', branch: 'next' },
    { from: 'scan', to: 'missing', branch: 'next' },
  ]) {
    assert.equal(connect(draft, edge), draft)
  }
})
