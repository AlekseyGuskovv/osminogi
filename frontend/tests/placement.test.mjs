import assert from 'node:assert/strict'
import { test } from 'node:test'
import { placeNode } from '../src/editor/placement.ts'
import { addNode } from '../src/editor/graph.ts'

test('placement searches away from occupied center without leaving the viewport', () => {
  const area = { x: 310, y: -205, width: 460, height: 300 }
  const center = { x: 540, y: -55 }
  const blocker = { x: 454, y: -97.5, width: 172, height: 85 }
  const placed = placeNode(area, [blocker], center)
  assert.ok(placed.x >= area.x && placed.x + 172 <= area.x + area.width)
  assert.ok(placed.y >= area.y && placed.y + 62 <= area.y + area.height)
  assert.ok(placed.x + 172 <= blocker.x - 10 || placed.x >= blocker.x + 182 ||
    placed.y + 62 <= blocker.y - 10 || placed.y >= blocker.y + 95)
})

test('placement centers a card in a smaller pane and clamps drops at an edge', () => {
  assert.deepEqual(placeNode({ x: 20, y: 40, width: 100, height: 60 }, [], { x: 22, y: 42 }), { x: -16, y: 39 })
  assert.deepEqual(placeNode({ x: 20, y: 40, width: 500, height: 300 }, [], { x: 515, y: 335 }, undefined, false), { x: 348, y: 278 })
  assert.deepEqual(placeNode({ x: 20, y: 40, width: 500, height: 300 }, [{ x: 0, y: 0, width: 600, height: 600 }],
    { x: 250, y: 200 }), { x: 164, y: 169 })
})

test('adding Start twice leaves the graph untouched', () => {
  const draft = { name: 'Test', schedule: null, nodes: [], edges: [] }
  const started = addNode(draft, 'start', { x: 10, y: 20 })
  assert.equal(addNode(started, 'start', { x: 30, y: 40 }), started)
})
