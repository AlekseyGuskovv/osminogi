import { WorkflowEditor } from './editor/WorkflowEditor'
import { TemplatesPage } from './templates/TemplatesPage'
import { RunsPage } from './runs/RunsPage'

export default function App() {
  const search = new URLSearchParams(window.location.search)
  const id = search.get('workflow') ?? 'wf-1'
  if (search.get('view') === 'templates') return <TemplatesPage workflowId={id} />
  if (search.get('view') === 'runs') return <RunsPage workflowId={id} runId={search.get('run') ?? undefined} />
  return <WorkflowEditor workflowId={id === 'new' ? undefined : id} ciRunId={search.get('ciRun') ?? undefined} copiedTemplate={search.get('setup') === '1'} />
}
