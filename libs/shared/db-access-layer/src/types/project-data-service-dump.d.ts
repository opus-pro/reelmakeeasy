import type { ProjectForBackend } from '@shared/types/api/project'
import type { ProjectAttachmentItemDto } from '@shared/types/api/project-attachment.zod'
import type { SourcePreferenceDto } from '@shared/types/api/source-preference.zod'

/** Shape persisted to / loaded from archive at EVAL_PATHS.dataServiceDumpPath */
export type ProjectDbAccessLayerDump = {
  project: ProjectForBackend
  sourcePreference: null | SourcePreferenceDto
  uploadedFiles: ProjectAttachmentItemDto[]
}
