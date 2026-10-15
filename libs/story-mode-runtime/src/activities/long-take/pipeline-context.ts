import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'
import { JobContext } from '@reelmakeeasy/common/job-context'

export function formatPipelineContext(): null | string {
  try {
    const entries = JobContext.getByKey('pipelineContext', null) as null | PipelineContextEntry[]
    if (!entries?.length) {
      return null
    }
    const body = entries.map(({ name, value }) => `${name}: ${value}`).join('\n')
    return `--- Pipeline Context ---\n${body}\n--- End Pipeline Context ---`
  } catch {
    return null
  }
}
