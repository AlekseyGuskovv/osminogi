interface ApiErrorBody {
  code: string
  message: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

export function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, { method: 'GET' })
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  let json: string | undefined
  try {
    json = JSON.stringify(body)
  } catch (cause) {
    throw new Error('Не удалось преобразовать тело запроса в JSON.', { cause })
  }
  if (json === undefined) {
    throw new Error('Не удалось преобразовать тело запроса в JSON.')
  }

  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json,
  })
}

export type SnapshotRef = { id: string; label: string; catalogSource?: 'organizer' }

export function apiUrl(path: string) {
  const configuredBase: string | undefined = import.meta.env?.VITE_API_BASE
  return `${(configuredBase ?? '/api/v1').replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function importSnapshot(file: File): Promise<SnapshotRef> {
  const body = new FormData()
  body.append('file', file)
  return requestJson<SnapshotRef>('/snapshots/import', { method: 'POST', body })
}

export function importTemplateYaml<T>(file: File): Promise<T> {
  return requestJson<T>('/templates/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/yaml' },
    body: file,
  })
}

const postErrorMessages: Partial<Record<number, string>> = {
  400: 'Некорректный запрос.',
  409: 'Запрос конфликтует с текущим состоянием ресурса.',
  422: 'Сервер не может обработать отправленные данные.',
  500: 'Внутренняя ошибка сервера. Попробуйте позже.',
}

async function requestJson<T>(path: string, options: RequestInit): Promise<T> {
  const url = apiUrl(path)

  let response: Response
  try {
    response = await fetch(url, options)
  } catch (cause) {
    throw new Error('Сервер недоступен. Проверьте подключение и попробуйте снова.', { cause })
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    if (response.ok) {
      throw new Error('Не удалось прочитать JSON-ответ сервера.', { cause })
    }
  }

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      const message = response.status === 404
        ? `Ресурс не найден. ${body.message}`.trimEnd()
        : body.message
      throw new ApiError(response.status, message, body.code)
    }

    const postMessage = options.method === 'POST' ? postErrorMessages[response.status] : undefined
    const message = response.status === 404
      ? 'Ресурс не найден'
      : postMessage ?? `Запрос завершился ошибкой (HTTP ${response.status}).`
    throw new ApiError(response.status, message)
  }

  return body as T
}
