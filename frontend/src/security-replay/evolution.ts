import type { Comparison, Run } from '../runs/types.ts'

export function isCompleted(run: Run) {
  return run.status === 'succeeded' || run.status === 'failed'
}

export function criticalCount(run: Run) {
  return run.findings.filter(finding => finding.severity === 'critical').length
}

export function resolvedIds(after: Run, diff: Comparison) {
  const active = new Set(after.findings.map(finding => finding.id))
  return [...new Set(diff.resolved)].filter(id => !active.has(id))
}

export function evolutionResult(before: Run, after: Run, resolved: string[], phase: 'before' | 'after') {
  const run = phase === 'before' ? before : after
  const ci = run.ci.status
  if (ci === 'error') return { title: 'Ошибка анализа', detail: 'CI не смог подтвердить результат проверки.' }
  if (ci === 'pending') return { title: 'Решение CI ожидается', detail: 'Итог проверки пока недоступен.' }
  if (phase === 'after' && criticalCount(after) > criticalCount(before)) {
    return { title: 'Критических рисков стало больше', detail: ci === 'passed' ? 'CI пройден по текущим правилам.' : 'CI не пройден.' }
  }
  if (ci === 'failed') return { title: 'CI не пройден', detail: run.ci.reason === 'CRITICAL_FOUND'
    ? 'Проверка обнаружила критическую уязвимость.' : 'Проверьте причины решения CI на графе.' }
  if (phase === 'after') {
    const critical = before.findings.filter(finding => finding.severity === 'critical' && resolved.includes(finding.id))
    if (critical.length) return {
      title: critical.length === 1 ? 'Критическая уязвимость устранена' : 'Критические уязвимости устранены',
      detail: `Сравнение с ${before.id} подтвердило устранение ${critical.map(finding => finding.id).join(', ')}. CI пройден.`,
    }
    if (resolved.length) return { title: 'Устранение подтверждено', detail: 'Повторная проверка прошла CI.' }
  }
  return { title: 'CI пройден', detail: phase === 'after' ? 'В сравнении нет подтверждённых устранений.' : 'Исходный запуск прошёл проверку.' }
}
