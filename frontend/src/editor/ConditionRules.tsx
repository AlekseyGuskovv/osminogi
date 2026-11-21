const metrics = {
  findingCount: { label: 'Все находки', operator: 'gte', value: 1 },
  filteredCount: { label: 'Находки с фильтром', operator: 'gte', value: 1 },
  maxSeverity: { label: 'Уровень риска', operator: 'gte', value: 'critical' },
  findingTitle: { label: 'Название находки', operator: 'regex', value: '' },
  findingPath: { label: 'Путь к файлу', operator: 'contains', value: '' },
} as const

type Metric = keyof typeof metrics
type Rule = { metric: Metric; operator: string; value: string | number; severity?: string; category?: string }
type RuleGroup = { mode: 'all' | 'any'; rules: Rule[] }

const severity = { low: 'Низкая', medium: 'Средняя', high: 'Высокая', critical: 'Критическая' }
const categories = { SECRET: 'Секреты', SCA: 'Зависимости', SAST: 'Анализ кода', GRADLE: 'Gradle' }
const comparisons = { eq: 'Ровно', ne: 'Не равно', gte: 'Не меньше', gt: 'Больше', lte: 'Не больше', lt: 'Меньше' }

function makeRule(metric: Metric): Rule {
  return { metric, operator: metrics[metric].operator, value: metrics[metric].value,
    ...(metric === 'filteredCount' ? { severity: 'critical', category: 'any' } : {}) }
}

function conditionRules(settings: Record<string, unknown>): RuleGroup {
  if (Array.isArray(settings.rules)) return { mode: settings.mode === 'any' ? 'any' : 'all', rules: settings.rules as Rule[] }
  const metric = settings.metric === 'findingCount' || settings.metric === 'findingTitle' ? settings.metric : 'maxSeverity'
  const rule = makeRule(metric)
  if (typeof settings.value === 'number' || typeof settings.value === 'string') rule.value = settings.value
  return { mode: 'all', rules: [rule] }
}

export function ConditionRules({ settings, disabled, onChange }: {
  settings: Record<string, unknown>; disabled: boolean; onChange: (group: RuleGroup) => void
}) {
  const group = conditionRules(settings)
  function update(index: number, rule: Rule) {
    onChange({ ...group, rules: group.rules.map((item, i) => i === index ? rule : item) })
  }

  return <fieldset disabled={disabled}>
    <legend>Правила ветвления</legend>
    {group.rules.length > 1 && <label>Ветка «Да», если выполнены
      <select value={group.mode} onChange={event => onChange({ ...group, mode: event.target.value === 'any' ? 'any' : 'all' })}>
        <option value="all">Все правила (И)</option><option value="any">Хотя бы одно правило (ИЛИ)</option>
      </select>
    </label>}
    {group.rules.map((rule, index) => {
      const numeric = rule.metric === 'findingCount' || rule.metric === 'filteredCount'
      return <fieldset key={index} className="garden-condition-rule">
        <legend>Правило {index + 1}</legend>
        <label>Что проверяем<select value={rule.metric} onChange={event => update(index, makeRule(event.target.value as Metric))}>
          {Object.entries(metrics).map(([key, metric]) => <option key={key} value={key}>{metric.label}</option>)}
        </select></label>
        {rule.metric === 'filteredCount' && <>
          <label>Критичность<select value={rule.severity} onChange={event => update(index, { ...rule, severity: event.target.value })}>
            <option value="any">Любая</option>
            {Object.entries(severity).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>Категория<select value={rule.category} onChange={event => update(index, { ...rule, category: event.target.value })}>
            <option value="any">Любая</option>
            {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </>}
        {numeric ? <>
          <label>Сравнение<select value={rule.operator} onChange={event => update(index, { ...rule, operator: event.target.value })}>
            {Object.entries(comparisons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>Число находок<input type="number" min="0" max="5000" step="1" value={rule.value}
            onChange={event => {
              const value = event.currentTarget.valueAsNumber
              if (event.currentTarget.validity.valid && Number.isInteger(value)) update(index, { ...rule, value })
            }} /></label>
        </> : rule.metric === 'maxSeverity' ? <label>Минимальная критичность
          <select value={rule.value} onChange={event => update(index, { ...rule, value: event.target.value })}>
            {Object.entries(severity).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          : <label>{rule.metric === 'findingTitle' ? 'Регулярное выражение' : 'Фрагмент пути'}
            <input maxLength={80} value={rule.value} onChange={event => update(index, { ...rule, value: event.target.value })} />
          </label>}
        {group.rules.length > 1 && <button type="button" onClick={() =>
          onChange({ ...group, rules: group.rules.filter((_, i) => i !== index) })}>Удалить правило</button>}
      </fieldset>
    })}
    {group.rules.length < 5 && <button type="button" onClick={() =>
      onChange({ ...group, rules: [...group.rules, makeRule('findingCount')] })}>Добавить правило</button>}
  </fieldset>
}
