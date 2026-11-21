import { speeds } from './playback'
import type { PlaybackSpeed } from './playback'
import type { Playback } from './usePlayback'

const names = { 0.5: 'Медленно 0.5×', 1: 'Обычно 1×', 2: 'Быстро 2×' }

export function PlaybackControls({ playback, speed, onSpeed }: {
  playback: Playback; speed: PlaybackSpeed; onSpeed: (speed: PlaybackSpeed) => void
}) {
  return <div className="pulse-controls" aria-label="Security Pulse">
    <label>Скорость анимации
      <select value={speed} onChange={event => {
        const next = speeds.find(value => String(value) === event.target.value)
        if (next) onSpeed(next)
      }}>
        {speeds.map(value => <option key={value} value={value}>{names[value]}</option>)}
      </select>
    </label>
    <button disabled={!playback.playing && !playback.paused} onClick={playback.toggle}>
      {playback.paused ? 'Продолжить' : 'Пауза'}
    </button>
    <button disabled={!playback.canReplay} onClick={playback.restart}>Повторить анимацию</button>
    {!playback.canReplay && <small>Запись событий пока недоступна</small>}
    {playback.partial && <small>Доступны последние события запуска</small>}
  </div>
}
