import type { Run } from './types.ts'
import type { RunStatus } from './events.ts'

export const errorHelp = {
  ai: ['Рекомендации AI', 'Проверьте доступность выбранной модели и повторите запуск.'],
  telegram: ['Доставка в Telegram', 'Проверьте подключение и права бота в чате.'],
  analysis: ['Анализ проекта', 'Проверьте снимок и настройки сценария, затем повторите запуск.'],
  comparison: ['Сравнение снимков', 'Выберите подходящий базовый снимок и повторите проверку.'],
} as const

export function isRunFinished(status: RunStatus) {
  return status === 'succeeded' || status === 'failed'
}

export function summarizeOutcome(run: Run) {
  const critical = run.findings.filter(item => item.severity === 'critical')
  const findings = critical.map(item => ({ title: item.title,
    detail: [item.path ? `${item.path}:${item.line}` : '', item.advisoryId].filter(Boolean).join(' · ') }))
  const technical = run.technicalErrors ?? []
  const errors: { title: string; detail: string }[] = technical.map(item => ({
    title: errorHelp[item.stage][0], detail: item.message,
  }))
  for (const step of run.steps) {
    if (step.status === 'failed' && step.error && !technical.some(item => item.nodeId === step.nodeId)) {
      errors.push({ title: 'Ошибка блока', detail: step.error.message })
    }
  }
  if (run.delivery === 'failed' && !technical.some(item => item.stage === 'telegram') &&
      !run.steps.some(step => step.status === 'failed' && step.error && run.graph?.nodes.some(node =>
        node.id === step.nodeId && node.type === 'telegram'))) {
    errors.push({ title: 'Доставка в Telegram', detail: 'Не удалось отправить отчёт.' })
  }
  const issues = [...errors, ...findings]
  if (run.status === 'failed' || (run.ci.status === 'error' && run.ci.reason !== 'NO_ANALYSIS')) {
    return { tone: 'error', title: 'Проверка завершилась с ошибкой',
      summary: errors.length ? 'Возникла техническая ошибка.' : 'Не удалось завершить выполнение сценария.', issues }
  }
  if (run.ci.status === 'failed') {
    return { tone: 'danger', title: 'Проверка не пройдена', summary: 'Найдены критические риски.', issues: [...findings, ...errors] }
  }
  if (run.ci.reason === 'NO_ANALYSIS' || run.ci.status === 'pending') {
    return { tone: 'warning', title: 'Нет результата анализа',
      summary: run.ci.reason === 'NO_ANALYSIS' ? 'Запустите сценарий с блоком анализа.' : 'Сценарий завершился без вердикта безопасности.', issues }
  }
  if (errors.length) {
    return { tone: 'warning', title: 'Анализ пройден с замечаниями',
      summary: 'Критических рисков нет. Некоторые шаги завершились ошибкой.', issues }
  }
  return { tone: 'success', title: 'Проверка пройдена',
    summary: run.findings.length ? 'Критических рисков нет. Остальные находки доступны в отчёте.' : 'Находок нет.', issues }
}
