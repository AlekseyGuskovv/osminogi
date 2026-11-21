import { TelegramConnectionPicker } from './TelegramConnectionPicker'
import { ConditionRules } from './ConditionRules'
import type { WorkflowDraft } from '../workflow'

type Props = {
  node: WorkflowDraft['nodes'][number]
  schedule: WorkflowDraft['schedule']
  disabled: boolean
  onSettingsChange: (settings: Record<string, unknown>) => void
  onScheduleChange: (schedule: WorkflowDraft['schedule']) => void
}

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

  return <ConditionRules settings={node.settings} disabled={disabled} onChange={onSettingsChange} />
}
