import { useEffect } from 'react'
import type { Run } from '../runs/types'
import { StatusBadge } from '../ui/StatusBadge'
import type { Playback } from './usePlayback'
import type { PlaybackSpeed } from './playback'
import { PlaybackControls } from './PlaybackControls'
import { FixDialog } from '../runs/FixDialog'
import { ExplainableCI } from './ExplainableCI'
import { TimeMachine } from './TimeMachine'

const titles = [
  'Проверяем безопасность проекта',
  'Обнаружена критическая уязвимость',
  'Исправляем уязвимость',
  'Проверка пройдена',
]

export function PresentationMode({ stage, setStage, onClose, run, error, playback, speed, onSpeed, activeLabel, onFocus, onCompare, onLongDemo, replayId, onReplayId }: {
  stage: number; setStage: (stage: number) => void; onClose: () => void
  run?: Run; error: string; playback: Playback; speed: PlaybackSpeed; onSpeed: (speed: PlaybackSpeed) => void; activeLabel?: string
  replayId: string; onReplayId: (id: string) => void
  onLongDemo: () => void; onFocus: (id: string) => void; onCompare: (run: Run | undefined) => void
}) {
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target
      if (target instanceof Element && target.closest('input, select, textarea, dialog, [contenteditable]')) return
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        setStage(Math.max(0, Math.min(3, stage + (event.key === 'ArrowRight' ? 1 : -1))))
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [stage, setStage, onClose])
  const finding = run?.findings.find(item => item.id === run.ci.findingId)

  return <section className="replay-panel replay-presentation" aria-label="Режим демонстрации">
    <header>
      <div><p className="replay-kicker">SECURITY REPLAY · ЭТАП {stage + 1} ИЗ 4</p><h2>{titles[stage]}</h2></div>
      <button onClick={onClose}>Выход</button>
    </header>
    {import.meta.env.VITE_USE_MOCKS === 'true' && <p className="replay-demo">Демо · тестовые данные</p>}
    {error && <p role="alert">{error}</p>}
    {!error && !run && <p role="status">Загружаем демонстрационный запуск…</p>}
    <div className="replay-controls">
      <button disabled={stage === 0} onClick={() => setStage(stage - 1)}>Назад</button>
      <button disabled={stage === 3} onClick={() => setStage(stage + 1)}>Далее</button>
    </div>
    <button type="button" onClick={onLongDemo}>Запустить длинное демо</button>
    {stage === 0 && <>
      <p className="replay-demo">Демо · реконструкция маршрута</p>
      <p>Блоки с пометкой «Маршрут · демо» показывают структуру графа. Их выполнение не подтверждено.</p>
      <label>Запуск для реконструкции
        <select value={replayId} onChange={event => onReplayId(event.target.value)}>
          <option value="run-1">run-1 · Критическая находка</option>
          <option value="run-2">run-2 · После исправления</option>
        </select>
      </label>
      <PlaybackControls playback={playback} speed={speed} onSpeed={onSpeed} />
    </>}
    {run && stage === 0 && <div>
      <p>Фактический итог {run.id}</p>
      <div className="replay-controls"><StatusBadge kind="run" status={run.status} />
        <StatusBadge kind="ci" status={run.ci.status} /></div>
      {activeLabel && <p>На графе · <strong>{activeLabel}</strong></p>}
      {playback.view?.ciStatus && <p className="pulse-ci-result" data-ci-status={playback.view.ciStatus}>
        CI {playback.view.ciStatus.toUpperCase()}
      </p>}
    </div>}
    {run && stage === 1 && <ExplainableCI key={run.id} run={run} onFocus={onFocus} />}
    {run && stage === 2 && (finding
      ? <FixDialog run={run} findingId={finding.id} />
      : <p>Для этого запуска нет связанной находки для предпросмотра.</p>)}
    {run && stage === 3 && <>
      <TimeMachine workflowId={run.workflowId} initialId={run.id} demo onFocus={onCompare} />
    </>}
  </section>
}
