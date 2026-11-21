import { useLayoutEffect, useRef } from 'react'
import { scannerDuration } from './playback'
import type { PlaybackSpeed } from './playback'

export function ScannerSweep({ speed, paused }: { speed: PlaybackSpeed; paused: boolean }) {
  const beam = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      const animation = beam.current?.getAnimations()[0]
      if (!animation) return

      // Updating the playback rate preserves the current position of the beam.
      animation.updatePlaybackRate(speed)
      if (paused) animation.pause()
      else animation.play()
    }
    sync()
    reducedMotion.addEventListener('change', sync)
    return () => reducedMotion.removeEventListener('change', sync)
  }, [speed, paused])

  return <span className="scanner-sweep" aria-hidden="true">
    <span className="scanner-beam" ref={beam} style={{ animationDuration: `${scannerDuration}ms` }} />
  </span>
}
