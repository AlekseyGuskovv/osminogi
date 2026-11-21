export function runsUrl(workflowId: string, runId?: string) {
  const params = new URLSearchParams({ view: 'runs', workflow: workflowId })
  if (runId) params.set('run', runId)
  return `?${params}`
}
