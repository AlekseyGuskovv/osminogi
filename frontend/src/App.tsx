import { IconGallery } from './ui/IconGallery'
import { WorkflowEditor } from './editor/WorkflowEditor'
import { TemplatesPage } from './templates/TemplatesPage'
import { RunsPage } from './runs/RunsPage'

export default function App() {
  const search = new URLSearchParams(window.location.search)
  const id = search.get('workflow') ?? (import.meta.env.VITE_USE_MOCKS === 'true' ? 'wf-1' : 'new')
  if (search.get('view') === 'prism-icons') return <IconGallery />
  if (search.get('view') === 'templates') return <TemplatesPage workflowId={id} />
  if (search.get('view') === 'runs') return <RunsPage workflowId={id} runId={search.get('run') ?? undefined} openTimeMachine={search.get('replay') === '1'} />
  return <WorkflowEditor workflowId={id === 'new' ? undefined : id} ciRunId={search.get('ciRun') ?? undefined} copiedTemplate={search.get('setup') === '1'} explain={search.get('explain') === '1'} replay={search.get('replay') === '1'} />
}
