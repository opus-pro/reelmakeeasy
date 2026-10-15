import type { ProjectForBackend } from '../project'
import type { ProjectAttachmentItemDto } from '../project-attachment.zod'
import type { SourcePreferenceDto } from '../source-preference.zod'

/**
 * Partial project data for specific queries
 */
export interface ProjectMetadata {
  avatarId?: null | string
  hookTemplateName?: null | string
  resultVideo?: null | string
  userId?: string
  voiceOverJson?: unknown
}

/**
 * Resolved avatar information, used to enrich project events with avatar type
 * and name.
 */
export interface ResolvedAvatarInfo {
  avatarId: string
  avatarName: string | undefined
  avatarType: 'none' | 'stock' | 'user'
}

/**
 * Data required to create a project (e.g. for tests or long-take workflow).
 */
export interface ProjectCreateData {
  id: string
  initPrompt: string
  isLongTake?: boolean
  name: string
  owner?: null | string
  ownerEmail?: null | string
  stage?: string
}

export type SelectedLongTakeProjectInfo = Pick<
  ProjectForBackend,
  'createdAt' | 'id' | 'name' | 'owner' | 'style' | 'styleText'
>

/**
 * Service that provides project and user-prefeence data.
 * Abstraction over the current data source (e.g. Prisma today, HTTP API later).
 * Engine-worker uses this for load-context; implementation is swappable.
 */
export interface ProjectDataService {
  /**
   * Create a project (e.g. for long-take local test).
   */
  createProject(data: ProjectCreateData): Promise<void>

  getLongTakeProjectsByCreatedDateRange(
    conditions: { fromDate: Date; toDate: Date } | { fromDate: Date } | { toDate: Date },
  ): Promise<SelectedLongTakeProjectInfo[]>
  getProject(projectId: string): Promise<null | ProjectForBackend>
  getProjectAttachments(projectId: string): Promise<ProjectAttachmentItemDto[]>
  /**
   * Get specific project metadata fields (avatarId, voiceOverJson, etc.)
   */
  getProjectMetadata(
    projectId: string,
    fields: (keyof ProjectMetadata)[],
  ): Promise<null | Partial<ProjectMetadata>>

  /** scriptRefId */
  getScriptRefId(projectId: string): Promise<null | string>

  getSourcePreference(userId: string): Promise<null | SourcePreferenceDto>
  /**
   * Replace project name directly, regardless of current value.
   */
  replaceProjectName(projectId: string, newName: string): Promise<void>

  /**
   * Resolve avatar type and name from an avatarId.
   * Checks stockAvatar table first, then aiAvatar table.
   * Returns { avatarType: 'none', avatarId: 'none', avatarName: undefined } if avatarId is empty/null.
   */
  resolveAvatarInfo(avatarId: null | string | undefined): Promise<ResolvedAvatarInfo>

  /**
   * Update first message reply sent
   */
  updateFirstMessageReplySent(projectId: string, sent: boolean): Promise<void>

  /**
   * Update project name (used for long-take ASR name generation)
   * Only updates if current name matches one of the placeholders
   */
  updateProjectName(
    projectId: string,
    newName: string,
    placeholders: readonly string[],
  ): Promise<number>

  /**
   * Update project stage
   */
  updateProjectStage(projectId: string, stage: string): Promise<void>

  /**
   * Update script confirmed
   */
  updateScriptConfirmed(projectId: string, confirmed: boolean): Promise<void>

  updateScriptRefId(projectId: string, scriptRefId: string): Promise<null | string>
}

export { ProjectAttachmentItemDto, SourcePreferenceDto }
