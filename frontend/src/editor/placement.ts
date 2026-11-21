import type { Point } from './graph.ts'

type Size = { width: number; height: number }
type Box = Point & Size

export const newNodeSize = { width: 172, height: 62 }

export function placeNode(
  area: Box,
  occupied: Box[],
  anchor: Point,
  { width, height }: Size = newNodeSize,
  avoidOverlap = true,
): Point {
  const minX = area.x
  const minY = area.y
  const maxX = minX + Math.max(0, area.width - width)
  const maxY = minY + Math.max(0, area.height - height)

  // If the viewport is smaller than the card, keep the card's center visible.
  const center = {
    x: area.width < width ? area.x + (area.width - width) / 2 : Math.min(maxX, Math.max(minX, anchor.x - width / 2)),
    y: area.height < height ? area.y + (area.height - height) / 2 : Math.min(maxY, Math.max(minY, anchor.y - height / 2)),
  }
  if (!avoidOverlap) return center

  const gap = 10
  const overlaps = (point: Point) => occupied.some(box =>
    point.x < box.x + box.width + gap && point.x + width + gap > box.x &&
    point.y < box.y + box.height + gap && point.y + height + gap > box.y,
  )
  if (!overlaps(center)) return center

  // Prefer the nearest free point on a small grid, including the viewport edges.
  const axis = (from: number, to: number, preferred: number) =>
    from === to ? [preferred] : [preferred, ...Array.from({ length: 9 }, (_, index) => from + (to - from) * index / 8)]
  let closest = center
  let distance = Infinity
  for (const x of axis(minX, maxX, center.x)) {
    for (const y of axis(minY, maxY, center.y)) {
      const offset = (x - center.x) ** 2 + (y - center.y) ** 2
      if (offset < distance && !overlaps({ x, y })) {
        closest = { x, y }
        distance = offset
      }
    }
  }
  return closest
}
