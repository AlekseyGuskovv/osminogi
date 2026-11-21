import { WorkflowEditor } from './editor/WorkflowEditor'
import { RunsPage } from './runs/RunsPage'

export default function App() {
  const search = new URLSearchParams(window.location.search)
  const id = search.get('workflow') ?? 'wf-1'
  if (search.get('view') === 'runs') return <RunsPage workflowId={id} runId={search.get('run') ?? undefined} />
  return <WorkflowEditor workflowId={id === 'new' ? undefined : id} />
}
