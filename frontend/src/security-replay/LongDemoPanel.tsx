import { useEffect } from 'react'
import { PlaybackControls } from './PlaybackControls'
import { longDemoWorkflow } from './longDemo'
import type { DemoScenario } from './longDemo'
import type { PlaybackSpeed } from './playback'
import type { Playback } from './usePlayback'
import type { WorkflowDraft } from '../workflow'
import { runsUrl } from '../runs/navigation'

export function LongDemoPanel({ scenario, onScenario, started, onStart, onBack, onClose, playback, onSpeed, activeLabel, graph, busy, error }: {
  scenario: DemoScenario; onScenario: (scenario: DemoScenario) => void; started: boolean; onStart: () => void
  onBack: () => void; onClose: () => void; playback: Playback; onSpeed: (speed: PlaybackSpeed) => void; activeLabel?: string
  graph?: Pick<WorkflowDraft, 'nodes'>; busy?: boolean; error?: string
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !(event.target instanceof HTMLSelectElement)) onClose()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])

  const mock = import.meta.env.VITE_USE_MOCKS === 'true'
  const nodes = graph?.nodes ?? (mock ? longDemoWorkflow.nodes : [])
  const view = playback.view
  const event = playback.event
  const nodeId = event?.type === 'node.status' && event.data.status !== 'skipped' ? event.data.nodeId : undefined
  const current = nodes.findIndex(node => node.id === nodeId) + 1
  const completed = nodes.filter(node => {
    const status = view?.nodes[node.id]?.status
    return status === 'skipped' || status === 'succeeded'
  }).length

  return <section className="replay-panel replay-presentation long-demo" aria-label="Длинное демо">
    <header><h2>{mock ? longDemoWorkflow.name : 'Учебная проверка Kotlin'}</h2><button onClick={onClose}>Выход</button></header>
    <p className="replay-demo">{mock ? 'Демо · симуляция выполнения' : 'Учебные снимки · реальные анализаторы'}</p>
    <div className="replay-controls" role="group" aria-label="Учебный сценарий">
      <button disabled={busy} aria-pressed={scenario === 'critical'} onClick={() => onScenario('critical')}>{mock ? 'Критическая угроза' : 'До правок'}</button>
      <button disabled={busy} aria-pressed={scenario === 'fixed'} onClick={() => onScenario('fixed')}>{mock ? 'После исправления' : 'После правок'}</button>
    </div>
    <p>{scenario === 'critical'
      ? 'Проверяем исходный учебный проект, в котором оставлены ошибки.'
      : 'Повторяем анализ после правок и сравниваем с исходным снимком.'}</p>
    {error && <p role="alert">{error}</p>}
    {!started && <button disabled={busy} onClick={onStart}>{busy ? 'Запускаем…' : 'Запустить'}</button>}
    <PlaybackControls playback={playback} speed={playback.speed} onSpeed={onSpeed} />
    {nodes.length > 0 && <div className="long-demo-progress">
      <label htmlFor="long-demo-progress">Обработано шагов · {completed} из {nodes.length}</label>
      <progress id="long-demo-progress" max={nodes.length} value={completed} />
      <p>{current > 0 && activeLabel ? <>Шаг {current} из {nodes.length} · <strong>{activeLabel}</strong></>
        : view?.ciStatus ? 'Маршрут завершён' : 'Готово к запуску'}</p>
    </div>}
    {view?.ciStatus && <p className="pulse-ci-result" data-ci-status={view.ciStatus}>CI {view.ciStatus.toUpperCase()}</p>}
    {!mock && view?.ciStatus && <a href={runsUrl('training-replay', view.id)}>Открыть отчёт</a>}
    <button onClick={onBack}>Вернуться к презентации</button>
  </section>
}
