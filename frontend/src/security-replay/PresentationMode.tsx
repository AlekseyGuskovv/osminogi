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
  'Повтор запуска',
  'Решение проверки безопасности',
  'Учебное исправление',
  'Сравнение запусков',
]

export function PresentationMode({ stage, setStage, onClose, run, error, playback, speed, onSpeed, activeLabel, onFocus, onCompare, onLongDemo, replayId, onReplayId, choices }: {
  stage: number; setStage: (stage: number) => void; onClose: () => void
  run?: Run; error: string; playback: Playback; speed: PlaybackSpeed; onSpeed: (speed: PlaybackSpeed) => void; activeLabel?: string
  replayId: string; onReplayId: (id: string) => void
  choices?: Run[]
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
  const mock = import.meta.env.VITE_USE_MOCKS === 'true'
  const findingId = run?.fixableFindingIds?.[0] ?? (mock ? run?.ci.findingId : undefined)

  return <section className="replay-panel replay-presentation" aria-label="Режим демонстрации">
    <header>
      <div><p className="replay-kicker">SECURITY REPLAY · ЭТАП {stage + 1} ИЗ 4</p><h2>{titles[stage]}</h2></div>
      <button onClick={onClose}>Выход</button>
    </header>
    {mock && <p className="replay-demo">Демо · тестовые данные</p>}
    {error && <p role="alert">{error}</p>}
    {!error && !run && <p role="status">{!choices ? 'Загружаем историю…' : choices.length ? 'Загружаем запуск…' : 'В этом сценарии пока нет завершённых запусков.'}</p>}
    <div className="replay-controls">
      <button disabled={stage === 0} onClick={() => setStage(stage - 1)}>Назад</button>
      <button disabled={stage === 3} onClick={() => setStage(stage + 1)}>Далее</button>
    </div>
    <button type="button" onClick={onLongDemo}>{mock ? 'Запустить длинное демо' : 'Запустить учебную проверку'}</button>
    {stage === 0 && <>
      <label>Запуск для повтора
        <select value={replayId} onChange={event => onReplayId(event.target.value)}>
          <option value="">Выберите запуск</option>
          {choices?.map(item => <option value={item.id} key={item.id}>
            {item.createdAt ? new Date(item.createdAt).toLocaleString('ru-RU') : item.id} · CI {item.ci.status}
          </option>)}
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
    {run && stage === 2 && (findingId
      ? <FixDialog key={run.id} run={run} findingId={findingId} />
      : <p>Для этого запуска нет связанной находки для предпросмотра.</p>)}
    {run && stage === 3 && <>
      <TimeMachine workflowId={run.workflowId} initialId={run.id} demo={mock} onFocus={onCompare} />
    </>}
  </section>
}
