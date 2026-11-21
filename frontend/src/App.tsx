import { WorkflowEditor } from './editor/WorkflowEditor'

export default function App() {
  const id = new URLSearchParams(window.location.search).get('workflow')
  return <WorkflowEditor workflowId={id === 'new' ? undefined : id ?? 'wf-1'} />
}
