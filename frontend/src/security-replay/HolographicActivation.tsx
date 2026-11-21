import { useLayoutEffect, useRef } from 'react'
import { activationDuration } from './playback'
import type { Playback } from './usePlayback'

export function HolographicActivation({ id, phase, bindMotion }: {
  id: string; phase: 'running' | 'succeeded'; bindMotion: Playback['bindMotion']
}) {
  const motion = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let animation = motion.current?.getAnimations()[0]
    animation?.pause()
    const sync = () => {
      animation = motion.current?.getAnimations()[0]
      animation?.pause()
    }
    reduced.addEventListener('change', sync)
    const unbind = bindMotion(id, time => {
      if (animation) animation.currentTime = Math.min(time, phase === 'running' ? activationDuration : 360)
    })
    return () => {
      unbind()
      reduced.removeEventListener('change', sync)
    }
  }, [id, phase, bindMotion])

  return <span className="hologram" data-phase={phase} aria-hidden="true">
    <span className="hologram-motion" ref={motion} style={{ animationDuration: `${phase === 'running' ? activationDuration : 360}ms` }}>
      <i /><i /><i /><i />
    </span>
  </span>
}
