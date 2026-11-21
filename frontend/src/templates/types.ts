import type { Workflow } from '../workflow'

export type Template = {
  id: string
  name: string
  description: string
  workflow: Workflow
}
