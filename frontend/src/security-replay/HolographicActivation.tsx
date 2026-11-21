import { useLayoutEffect, useRef } from 'react'
import { activationDuration } from './playback'
import type { PlaybackSpeed } from './playback'

export function HolographicActivation({ phase, speed, paused }: {
  phase: 'running' | 'succeeded'; speed: PlaybackSpeed; paused: boolean
}) {
  const motion = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    function sync() {
      const animation = motion.current?.getAnimations()[0]
      if (!animation) return

      animation.updatePlaybackRate(speed)
      if (animation.playState === 'finished') return
      if (paused) animation.pause()
      else if (animation.playState === 'paused') animation.play()
    }
    sync()
    reduced.addEventListener('change', sync)
    return () => reduced.removeEventListener('change', sync)
  }, [phase, speed, paused])

  return <span className="hologram" data-phase={phase} aria-hidden="true">
    <span className="hologram-motion" ref={motion} style={{ animationDuration: `${phase === 'running' ? activationDuration : 180}ms` }}>
      <i /><i /><i /><i />
    </span>
  </span>
}
