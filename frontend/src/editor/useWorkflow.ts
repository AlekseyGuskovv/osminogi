import { postJson } from '../api.ts'
import type { Workflow, WorkflowDraft } from '../workflow.ts'

export type EditableWorkflow = WorkflowDraft & { id?: string; revision?: number }

export function saveDraft(draft: EditableWorkflow): Promise<Workflow> {
  const { id, revision, ...body } = draft
  if (id === undefined) return postJson<Workflow>('/workflows', body)
  return postJson<Workflow>(`/workflows/${encodeURIComponent(id)}/save`, { ...body, revision })
}

export function newWorkflow(): WorkflowDraft {
  return {
    name: 'Новый сценарий',
    schedule: null,
    nodes: [
      { id: 'start', type: 'start', x: 40, y: 40, settings: {} },
      { id: 'end', type: 'finish', x: 300, y: 40, settings: {} },
    ],
    edges: [{ from: 'start', to: 'end', branch: 'next' }],
  }
}
