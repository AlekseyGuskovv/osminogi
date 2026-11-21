import { useEffect } from 'react'
import { PlaybackControls } from './PlaybackControls'
import { longDemoWorkflow } from './longDemo'
import type { DemoScenario } from './longDemo'
import type { PlaybackSpeed } from './playback'
import type { Playback } from './usePlayback'

export function LongDemoPanel({ scenario, onScenario, started, onStart, onBack, onClose, playback, onSpeed, activeLabel }: {
  scenario: DemoScenario; onScenario: (scenario: DemoScenario) => void; started: boolean; onStart: () => void
  onBack: () => void; onClose: () => void; playback: Playback; onSpeed: (speed: PlaybackSpeed) => void; activeLabel?: string
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !(event.target instanceof HTMLSelectElement)) onClose()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])

  const nodes = longDemoWorkflow.nodes
  const view = playback.view
  const event = playback.event
  const nodeId = event?.type === 'node.status' && event.data.status !== 'skipped' ? event.data.nodeId : undefined
  const current = nodes.findIndex(node => node.id === nodeId) + 1
  const completed = nodes.filter(node => {
    const status = view?.nodes[node.id]?.status
    return status === 'skipped' || status === 'succeeded'
  }).length

  return <section className="replay-panel replay-presentation long-demo" aria-label="Длинное демо">
    <header><h2>{longDemoWorkflow.name}</h2><button onClick={onClose}>Выход</button></header>
    <p className="replay-demo">Демо · симуляция выполнения</p>
    <div className="replay-controls" role="group" aria-label="Учебный сценарий">
      <button aria-pressed={scenario === 'critical'} onClick={() => onScenario('critical')}>Критическая угроза</button>
      <button aria-pressed={scenario === 'fixed'} onClick={() => onScenario('fixed')}>После исправления</button>
    </div>
    <p>{scenario === 'critical'
      ? 'Учебная критическая находка направляет поток по YES. Доставка Telegram смоделирована.'
      : 'После учебного исправления поток идёт по NO. Telegram пропускается, некритическая находка может остаться.'}</p>
    {!started && <button onClick={onStart}>Запустить</button>}
    <PlaybackControls playback={playback} speed={playback.speed} onSpeed={onSpeed} />
    <div className="long-demo-progress">
      <label htmlFor="long-demo-progress">Обработано шагов · {completed} из {nodes.length}</label>
      <progress id="long-demo-progress" max={nodes.length} value={completed} />
      <p>{current > 0 && activeLabel ? <>Шаг {current} из {nodes.length} · <strong>{activeLabel}</strong></>
        : view?.ciStatus ? 'Маршрут завершён' : 'Готово к запуску'}</p>
    </div>
    {view?.ciStatus && <p className="pulse-ci-result" data-ci-status={view.ciStatus}>CI {view.ciStatus.toUpperCase()}</p>}
    <button onClick={onBack}>Вернуться к презентации</button>
  </section>
}
