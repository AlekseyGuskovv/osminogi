export function runsUrl(workflowId: string, runId?: string, options?: { showOutcome: boolean }) {
  const params = new URLSearchParams({ view: 'runs', workflow: workflowId })
  if (runId) params.set('run', runId)
  if (runId && options?.showOutcome) params.set('outcome', '1')
  return `?${params}`
}
