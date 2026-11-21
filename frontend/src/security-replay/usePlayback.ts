import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { RunEvent } from '../runs/events'
import { applyRunEvent } from '../runs/useRun'
import type { RunView } from '../runs/useRun'
import type { WorkflowDraft } from '../workflow'
import { advanceTime, confirmedEdge, frameDuration, frameProgress, simulationEdge } from './playback'
import type { PlaybackSpeed, ReplayLog } from './playback'

type Edge = WorkflowDraft['edges'][number]
type Frame = { demo: boolean; repetition: number; view: RunView; event: RunEvent; completedNode?: string; edge?: Edge }

export function usePlayback(log: ReplayLog | undefined, edges: readonly Edge[], speed: PlaybackSpeed, surface: RefObject<HTMLElement | null>, demo: boolean) {
  const [paused, setPaused] = useState(false)
  const [repetition, setRepetition] = useState(0)
  const [frame, setFrame] = useState<Frame>()
  const [playing, setPlaying] = useState(false)
  const cursor = useRef<{ id: string; demo: boolean; repetition: number; index: number; elapsed: number; duration: number; view: RunView; active?: Frame }>(undefined)

  useLayoutEffect(() => {
    const element = surface.current
    if (!log || !element) {
      cursor.current = undefined
      return
    }
    const { base, offset, events } = log
    if (!cursor.current || cursor.current.id !== base.id || cursor.current.repetition !== repetition || cursor.current.demo !== demo) {
      cursor.current = { id: base.id, demo, repetition, index: offset, elapsed: 0, duration: 0, view: base }
    }
    const state = cursor.current
    if (state.index < offset) {
      Object.assign(state, { index: offset, elapsed: 0, duration: 0, view: base, active: undefined })
    }
    let request = 0
    let last = performance.now()
    let wasActive: boolean | undefined
    const tick = (now: number) => {
      state.elapsed = advanceTime(state.elapsed, now - last, speed, paused)
      last = now
      while (state.elapsed >= state.duration) {
        const event = events[state.index - offset]
        if (!event) break
        state.elapsed -= state.duration
        const edge = log.source === 'simulation'
          ? simulationEdge(event, events[state.index - offset + 1], edges)
          : confirmedEdge(event, state.view, edges)
        const completedNode = event.type === 'node.status' && event.data.status === 'succeeded' &&
          state.view.nodes[event.data.nodeId]?.status === 'running' ? event.data.nodeId : undefined
        state.view = applyRunEvent(state.view, event)
        state.active = { demo, repetition, view: state.view, event, edge, completedNode }
        state.index++
        state.duration = frameDuration(event, Boolean(edge), log.source)
        setFrame(state.active)
      }
      const active = state.elapsed < state.duration
      if (active !== wasActive) setPlaying(active)
      wasActive = active
      const motion = frameProgress(Math.min(state.elapsed, state.duration), Boolean(state.active?.edge))
      element.style.setProperty('--pulse-offset', String(8 - motion.travel * 108))
      element.style.setProperty('--pulse-trail', String(motion.trail))
      element.style.setProperty('--pulse-arrival', String(motion.arrival))
      element.style.setProperty('--pulse-alert', String(Math.max(0, 1 - state.elapsed / 370)))
      if (active) request = requestAnimationFrame(tick)
      else state.elapsed = state.duration
    }
    if (!paused) tick(last)
    return () => cancelAnimationFrame(request)
  }, [log, edges, paused, repetition, speed, surface, demo])

  const current = frame?.demo === demo && frame.repetition === repetition && frame.view.id === log?.base.id ? frame : undefined
  const view = current?.view
  const activating = view && view.status !== 'succeeded' && view.status !== 'failed' &&
    Object.values(view.nodes).some(node => node.status === 'running')
  return {
    view,
    event: current?.event,
    completedNode: playing ? current?.completedNode : undefined,
    edge: playing ? current?.edge : undefined,
    playing: Boolean(current && playing),
    paused,
    speed,
    repetition,
    canPause: Boolean(current && (playing || activating)),
    canReplay: Boolean(log?.events.length),
    partial: Boolean(log?.offset),
    toggle: () => setPaused(value => !value),
    restart: () => { setPaused(false); setRepetition(value => value + 1) },
  }
}

export type Playback = ReturnType<typeof usePlayback>
