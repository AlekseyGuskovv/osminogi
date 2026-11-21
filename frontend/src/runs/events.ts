export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type CiStatus = 'pending' | 'passed' | 'failed' | 'error'

type RunEventPayload =
  | { type: 'run.status'; data: { status: RunStatus } }
  | {
      type: 'node.status'
      data: {
        nodeId: string
        status: RunStatus | 'skipped'
        input?: unknown
        output?: unknown
        error?: { code: string; message: string }
      }
    }
  | { type: 'run.finished'; data: { status: RunStatus; ciStatus: CiStatus } }

export type RunEvent = RunEventPayload & { seq: number; runId: string; at: string }
export type OnRunEvent = (event: RunEvent) => void | Promise<void>

const runStatuses = new Set<string>(['queued', 'running', 'succeeded', 'failed'])
const ciStatuses = new Set<string>(['pending', 'passed', 'failed', 'error'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRunEvent(message: string, runId: string): RunEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(message)
  } catch {
    return
  }

  if (!isObject(value) || value.runId !== runId || typeof value.at !== 'string' ||
    typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq) || value.seq < 1 ||
    !isObject(value.data) || typeof value.data.status !== 'string') return

  const { type, data } = value
  if (type === 'node.status') {
    if (typeof data.nodeId !== 'string' || (!runStatuses.has(value.data.status) && value.data.status !== 'skipped')) return
  } else if (type === 'run.status' || type === 'run.finished') {
    if (!runStatuses.has(value.data.status)) return
    if (type === 'run.finished' && (typeof data.ciStatus !== 'string' || !ciStatuses.has(data.ciStatus))) return
  } else {
    return
  }

  return value as RunEvent
}

export function subscribeRun(
  runId: string,
  onEvent: OnRunEvent,
  onClosed?: () => Promise<boolean>,
): () => void {
  const configuredBase: string | undefined = import.meta.env?.VITE_API_BASE
  const base = (configuredBase ?? '/api/v1').replace(/\/+$/, '')
  const url = `${base}/runs/${encodeURIComponent(runId)}/events`
  let source: EventSource | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let finishing = false
  let lastSeq = 0
  let pending = Promise.resolve()

  function close() {
    closed = true
    clearTimeout(retry)
    source?.close()
  }

  function open() {
    const stream = new EventSource(url)
    source = stream
    stream.onmessage = message => {
      if (closed || finishing || stream !== source) return
      const event = parseRunEvent(message.data, runId)
      if (!event || event.seq <= lastSeq) return
      lastSeq = event.seq
      finishing = event.type === 'run.finished'
      pending = pending.then(async () => {
        if (!closed) await onEvent(event)
      }).catch(error => {
        console.error('Не удалось обработать событие запуска.', error)
      }).finally(() => {
        if (event.type === 'run.finished') close()
      })
    }
    stream.onerror = () => {
      // Native reconnects retain Last-Event-ID. Explicitly refresh only after a terminal disconnect.
      if (closed || finishing || stream !== source || stream.readyState !== EventSource.CLOSED) return
      source = undefined
      void onClosed?.().then(resume => {
        if (resume && !closed) retry = setTimeout(open, 1000)
      }).catch(error => console.error('Не удалось обновить состояние запуска.', error))
    }
  }

  open()
  return close
}
