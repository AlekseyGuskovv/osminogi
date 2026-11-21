import { HttpResponse } from 'msw'
import type { Run } from '../runs/types'

type RunEvent =
  | { type: 'run.status'; data: { status: 'running' } }
  | {
      type: 'node.status'
      data: { nodeId: string; status: 'running' | 'succeeded' | 'failed'; output?: { findingIds: string[]; branch?: 'yes' | 'no' }; error?: { code: string; message: string } }
    }
  | { type: 'run.finished'; data: { status: Run['status']; ciStatus: Run['ci']['status'] } }

export function runEvents(run: Run, at: string, readyAt: number, lastEventId: string | null) {
  const events: RunEvent[] = [{ type: 'run.status', data: { status: 'running' } }]
  const node = run.status === 'failed'
    ? run.steps.find(step => step.status === 'failed')
    : run.steps.find(step => step.status === 'succeeded' && step.branch === undefined)
  if (node) {
    events.push({ type: 'node.status', data: { nodeId: node.nodeId, status: 'running' } })
    events.push({
      type: 'node.status',
      data: node.status === 'failed'
        ? { nodeId: node.nodeId, status: 'failed', error: node.error }
        : {
            nodeId: node.nodeId,
            status: 'succeeded',
            output: { findingIds: run.findings.filter(finding => finding.nodeId === node.nodeId).map(finding => finding.id) },
          },
    })
  }
  const gate = run.steps.find(step => step.branch !== undefined)
  if (gate) {
    events.push({
      type: 'node.status',
      data: {
        nodeId: gate.nodeId,
        status: 'succeeded',
        output: { branch: gate.branch, findingIds: run.findings.map(finding => finding.id) },
      },
    })
  }
  events.push({ type: 'run.finished', data: { status: run.status, ciStatus: run.ci.status } })

  const acknowledged = Number(lastEventId)
  let index = Number.isSafeInteger(acknowledged) && acknowledged > 0 ? acknowledged : 0
  if (index >= events.length) {
    // HTTP 204 tells EventSource to stop reconnecting after the final event.
    return new HttpResponse(null, { status: 204 })
  }

  let timer: ReturnType<typeof setInterval>
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        const event = events[index]
        if (event.type === 'run.finished' && Date.now() < readyAt) return

        const seq = ++index
        const payload = { seq, type: event.type, runId: run.id, at, data: event.data }
        controller.enqueue(encoder.encode(`id: ${seq}\ndata: ${JSON.stringify(payload)}\n\n`))
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
