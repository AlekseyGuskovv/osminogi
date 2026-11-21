import { HttpResponse } from 'msw'
import type { makeRun } from './fixtures'

export function runEvents(run: ReturnType<typeof makeRun>, lastEventId: string | null) {
  const events = [
    { type: 'run.status', status: 'running' },
    { type: 'node.status', nodeId: 'secrets', status: 'running' },
    run.status === 'failed'
      ? { type: 'node.status', nodeId: 'secrets', status: 'failed', code: run.ci.reason }
      : {
          type: 'node.status',
          nodeId: 'secrets',
          status: 'succeeded',
          findingIds: run.findings.filter(finding => finding.id === 'F-key').map(finding => finding.id),
        },
    ...(run.status === 'succeeded'
      ? [{
          type: 'node.status',
          nodeId: 'condition',
          status: 'succeeded',
          branch: run.ci.status === 'failed' ? 'yes' : 'no',
        }]
      : []),
    { type: 'run.finished', status: run.status, ciStatus: run.ci.status },
  ]

  const acknowledged = Number(lastEventId)
  const start = Number.isSafeInteger(acknowledged) && acknowledged > 0 ? acknowledged : 0
  if (start >= events.length) {
    // HTTP 204 tells EventSource to stop reconnecting after the final event.
    return new HttpResponse(null, { status: 204 })
  }

  let index = start
  let timer: ReturnType<typeof setInterval>
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        const event = events[index]
        const seq = ++index
        controller.enqueue(encoder.encode(`id: ${seq}\ndata: ${JSON.stringify({ ...event, seq })}\n\n`))
        if (index === events.length) {
          clearInterval(timer)
          controller.close()
        }
      }, 120)
    },
    cancel() {
      clearInterval(timer)
    },
  })

  return new HttpResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
