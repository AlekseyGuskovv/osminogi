import { postJson } from '../api.ts'
import type { Workflow, WorkflowDraft } from '../workflow.ts'

export type EditableWorkflow = WorkflowDraft & { id?: string; revision?: number }

export function saveDraft(draft: EditableWorkflow): Promise<Workflow> {
  const { id, revision, ...body } = draft
  if (id === undefined) return postJson<Workflow>('/workflows', body)
  return postJson<Workflow>(`/workflows/${encodeURIComponent(id)}/save`, { ...body, revision })
}

export function newWorkflow(standard = false): WorkflowDraft {
  if (standard) {
    const types = ['start', 'secrets', 'sca', 'sast', 'finish'] as const
    return {
      name: 'Проверка Kotlin-проекта',
      schedule: null,
      nodes: types.map((type, index) => ({ id: type, type, x: 40 + index * 208, y: 70, settings: {} })),
      edges: types.slice(1).map((to, index) => ({ from: types[index], to, branch: 'next' })),
    }
  }
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
