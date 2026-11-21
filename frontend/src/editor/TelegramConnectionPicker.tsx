import { useEffect, useRef, useState } from 'react'
import { getJson, postJson } from '../api'

import type { ConnectionRef } from '../workflow'

type Props = { value: string; disabled: boolean; onSelect: (id: string) => void }

export function TelegramConnectionPicker({ value, disabled, onSelect }: Props) {
  const [connections, setConnections] = useState<ConnectionRef[]>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const inFlight = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let active = true
    void getJson<ConnectionRef[]>('/connections')
      .then(items => { if (active) setConnections(items) })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить подключения.')
      })
    return () => { active = false }
  }, [attempt])

  async function create(form: HTMLFormElement) {
    if (inFlight.current) return
    const data = new FormData(form)
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      const connection = await postJson<ConnectionRef>('/connections', {
        type: 'telegram', name: data.get('name'), chatId: data.get('chatId'), token: data.get('token'),
      })
      form.reset()
      if (!mounted.current) return
      setConnections(current => [...(current ?? []), connection])
      onSelect(connection.id)
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Не удалось создать подключение.')
    } finally {
      inFlight.current = false
      if (mounted.current) setPending(false)
    }
  }

  return <div className="garden-connection-picker">
    <label>Канал Telegram<select className="garden-connection-select" value={value} disabled={pending || disabled}
      onChange={event => onSelect(event.target.value)}>
      <option value="">Выберите канал</option>
      {value && !connections?.some(connection => connection.id === value) && <option value={value}>{value}</option>}
      {connections?.filter(connection => connection.configured).map(connection =>
        <option key={connection.id} value={connection.id}>{connection.name}</option>)}
    </select></label>
    {!connections && !error && <p role="status">Загрузка подключений…</p>}
    {error && <p role="alert">{error}</p>}
    {error && !connections && <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1) }}>Повторить</button>}
    <details><summary>Добавить подключение</summary>
      <form onSubmit={event => { event.preventDefault(); void create(event.currentTarget) }}>
        <label>Название<input required name="name" autoComplete="off" disabled={pending || disabled} /></label>
        <label>Chat ID<input required name="chatId" autoComplete="off" disabled={pending || disabled} /></label>
        <label>Токен бота<input required name="token" type="password" autoComplete="new-password" disabled={pending || disabled} /></label>
        <button disabled={pending || disabled}>{pending ? 'Сохранение…' : 'Сохранить подключение'}</button>
      </form>
    </details>
  </div>
}
