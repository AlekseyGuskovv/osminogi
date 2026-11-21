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

export async function getJson<T>(path: string): Promise<T> {
  const configuredBase: string | undefined = import.meta.env.VITE_API_BASE
  const base = (configuredBase ?? '/api/v1').replace(/\/+$/, '')
  const url = `${base}/${path.replace(/^\/+/, '')}`

  let response: Response
  try {
    response = await fetch(url, { method: 'GET' })
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

    const message = response.status === 404
      ? 'Ресурс не найден'
      : `Запрос завершился ошибкой (HTTP ${response.status}).`
    throw new ApiError(response.status, message)
  }

  return body as T
}
