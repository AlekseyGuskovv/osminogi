import { TelegramConnectionPicker } from './TelegramConnectionPicker'
import type { WorkflowDraft } from '../workflow'

type Props = {
  node: WorkflowDraft['nodes'][number]
  schedule: WorkflowDraft['schedule']
  disabled: boolean
  onSettingsChange: (settings: Record<string, unknown>) => void
  onScheduleChange: (schedule: WorkflowDraft['schedule']) => void
}

const metrics = {
  maxSeverity: { label: 'Максимальная критичность', operator: 'gte', value: 'critical' },
  findingCount: { label: 'Число находок', operator: 'gte', value: 1 },
  findingTitle: { label: 'Название находки', operator: 'regex', value: '' },
} as const

export function NodeSettings({ node, schedule, disabled, onSettingsChange, onScheduleChange }: Props) {
  if (node.type === 'start') {
    return <fieldset disabled={disabled}>
      <legend>Расписание</legend>
      <label><input type="checkbox" checked={schedule !== null}
        onChange={event => onScheduleChange(event.target.checked ? { time: '09:00', timezone: 'Europe/Moscow' } : null)} />
        Запуск по расписанию</label>
      {schedule && <>
        <label>Время<input type="time" value={schedule.time}
          onChange={event => onScheduleChange({ ...schedule, time: event.target.value })} /></label>
        <label>Часовой пояс<input value={schedule.timezone}
          onChange={event => onScheduleChange({ ...schedule, timezone: event.target.value })} /></label>
      </>}
    </fieldset>
  }

  if (node.type === 'telegram') {
    return <fieldset disabled={disabled}>
      <legend>Доставка</legend>
      <TelegramConnectionPicker value={String(node.settings.channelId ?? '')} disabled={disabled}
        onSelect={channelId => {
          const settings = { ...node.settings }
          if (channelId) settings.channelId = channelId
          else delete settings.channelId
          onSettingsChange(settings)
        }} />
    </fieldset>
  }

  if (node.type !== 'condition') return null

  const metric = node.settings.metric === 'findingCount' || node.settings.metric === 'findingTitle'
    ? node.settings.metric : 'maxSeverity'
  const value = node.settings.value ?? metrics[metric].value
  const updateValue = (next: string | number) =>
    onSettingsChange({ ...node.settings, metric, operator: metrics[metric].operator, value: next })

  return <fieldset disabled={disabled}>
    <legend>Правило ветвления</legend>
    <label>Метрика<select value={metric} onChange={event => {
      const next = event.target.value as keyof typeof metrics
      onSettingsChange({ ...node.settings, metric: next, operator: metrics[next].operator, value: metrics[next].value })
    }}>
      {Object.entries(metrics).map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
    </select></label>
    {metric === 'maxSeverity' && <label>Порог критичности<select value={String(value)} onChange={event => updateValue(event.target.value)}>
      <option value="low">Низкий</option>
      <option value="medium">Средний</option>
      <option value="high">Высокий</option>
      <option value="critical">Критический</option>
    </select></label>}
    {metric === 'findingCount' && <label>Минимум находок<input type="number" min="0" step="1" value={Number(value)}
      onChange={event => { if (event.currentTarget.validity.valid && event.currentTarget.value !== '') updateValue(event.currentTarget.valueAsNumber) }} /></label>}
    {metric === 'findingTitle' && <label>Регулярное выражение<input value={String(value)}
      onChange={event => updateValue(event.target.value)} /></label>}
  </fieldset>
}
