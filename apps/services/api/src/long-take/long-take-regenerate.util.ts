// Regenerate a long-take into a NEW project, reusing the source artifacts
// through keyframes. Two modes:
//   - 'completed': a completed source re-run with the selected transition video
//     model, which may stay at the same quality/model or upgrade.
//   - 'retry': a FAILED/CANCELED source that got far enough to persist the
//     reusable artifacts (keyframes + shot plan + voiceover), re-driven from
//     those artifacts with any model the caller picks (same model allowed).
// Either way the API layer owns validation, new-project seeding, and the
// workflow start; the slim LongTakeRegenerateWorkflow copies
// the source artifacts and re-runs only transitions + render, unchanged.

import type { InputJsonValue } from '@reelmakeeasy/api-db'
import { readCaptionStyleSettings } from '@reelmakeeasy/common/adapters/caption/caption-style'
import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { sanitizeCameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import { sanitizeGenerationResolution } from '@reelmakeeasy/common/model-config/story-mode-generation-resolution-config.zod'
import type { UserInfo } from '@reelmakeeasy/common/types/user'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { deleteStoredFile } from '@reelmakeeasy/common/storage/stored-files'
import {
  getDefaultVideoModelId,
  validateVideoModelId,
} from '@reelmakeeasy/common/veo3/video-model-selection'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { getWorkflowId } from '@reelmakeeasy/common/workflow/workflow-id'
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'
import type { ProjectForBackend, ProjectStage } from '@shared/types/api/project'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import type { DebugSettings } from '@shared/types/project/debug-settings'

import { normalizeTimeline } from '../uip/uip-timeline-transformers'
import type { TimelineFile } from '../uip/uip-timeline-types'

import { startStandaloneAdmissionWorkflow } from './admission-helpers'
import { carrySourceProjectObject } from './long-take-carry-source-media.util'
import { LONG_TAKE_KEYFRAMES_PATH, LONG_TAKE_SHOT_PLAN_PATH } from './long-take-paths'
import type { LineageUpdate } from './long-take-lineage.util'
import { readDebugSettings } from './long-take-reimagine-tier.util'
import { assertTransitionSlotsFeasible } from './long-take-transition-slot-preflight'
import {
  buildCameraStyleWorkflowArgs,
  buildQueuedAdmissionMeta,
  normalizeRatio,
  persistDebugOverrides,
  resolveStoryModeTaskQueue,
} from './long-take-workflow.util'
import type { WorkflowDeps } from './types'

export const LONG_TAKE_REGENERATE_WORKFLOW_NAME = 'LongTakeRegenerateWorkflow'

export { readDebugSettings } from './long-take-reimagine-tier.util'

export interface CreateSeededRegenerateProjectOptions {
  modelSelectorTier?: ProjectForBackend['modelSelectorTier']
  styleOverride?: SeededStyleOverride
  transitionVideoModel: string
}

export interface RegenerateLongTakeDeps extends WorkflowDeps {
  prisma: {
    project: {
      update: (args: { data: Record<string, unknown>; where: { id: string } }) => Promise<unknown>
      updateMany: LineageUpdate
    }
    uipSession: {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>
      findUnique: (args: { where: { projectId: string } }) => Promise<null | {
        aspectRatio: null | string
        entryUseCase: null | string
        imageModel: null | string
        modelSelectorTier: ProjectForBackend['modelSelectorTier']
        phase: string
        specVersion: number
        timeline: unknown
        track: null | string
        transitionVideoModel: null | string
        voiceId: null | string
      }>
    }
  }
  projectsService: {
    canVisitProject: (projectId: string) => Promise<boolean>
    createProject: (
      body: Record<string, unknown>,
      options?: { isUip?: boolean; rerunFrom?: string },
    ) => Promise<{ id: string }>
    deleteProject: (projectId: string, user: UserInfo) => Promise<unknown>
    getProject: (projectId: string) => Promise<null | ProjectForBackend>
    internalUpdateProject: (
      projectId: string,
      data: Record<string, unknown>,
      userSub: string,
    ) => Promise<unknown>
  }
}

export interface RegenerateLongTakeParams {
  sourceProjectId: string
  transitionVideoModel: string
  user: UserInfo
}

export type RegenerateMode = 'completed' | 'retry'

// Replaces (rather than inherits) the source's three style fields when seeding
// the new project. Only the restyle sibling passes one; regenerate omits it and
// keeps copying the source style verbatim.
export interface SeededStyleOverride {
  styleName: string
  styleText: string
  styleThumbnailUrl?: string
}

// Minimal shot-plan shape the transition-slot preflight needs; time_range is in
// seconds, so the last shot's end is the video length (what the workflow re-measures
// from the voiceover).
interface ShotPlanTiming {
  time_range?: { end?: number }
}

export async function regenerateLongTakeIntoNewProject(
  deps: RegenerateLongTakeDeps,
  params: RegenerateLongTakeParams,
): Promise<{ projectId: string; workflowId: string }> {
  const { sourceProjectId, user } = params
  const { mode, source } = await loadEligibleSourceProject(deps, sourceProjectId)
  const durationSeconds = await resolveRegenerateDurationSeconds(mode, source, sourceProjectId)
  const targetModel = resolveValidatedTargetModel(params.transitionVideoModel)
  const sourceDebugSettings = readDebugSettings(source.debugSettings)
  await assertTransitionSlotsFeasible(sourceProjectId, targetModel, durationSeconds)

  const newProjectId = await createSeededRegenerateProject(deps, source, sourceProjectId, {
    transitionVideoModel: targetModel,
  })
  const workflowId = getWorkflowId(newProjectId, 'story-mode')
  // The bed the NEW project owns after the seed copy, so the workflow
  // mixes the object this project's row advertises rather than the source's.
  let carriedBgmBedUri: string | undefined
  let workflowBgmBedUri: string | undefined
  try {
    const seeded = await persistRegenerateSeedFields(deps, {
      newProjectId,
      // Recorded before the row writes, not from the return value: a row write
      // that throws would otherwise strand the object this run just copied.
      onBedCarried: (fileUri) => {
        carriedBgmBedUri = fileUri
      },
      source,
      sourceProjectId,
      targetModel,
      userSub: user.sub,
    })
    workflowBgmBedUri = seeded.bgmBedUri
    await startRegenerateWorkflow(deps, {
      ...(workflowBgmBedUri ? { bgmBedUri: workflowBgmBedUri } : {}),
      newProjectId,
      source,
      sourceDebugSettings,
      sourceProjectId,
      targetModel,
      user,
      workflowId,
    })
  } catch (error) {
    await releaseRegenerateResources(deps, { carriedBgmBedUri, newProjectId, user })
    throw error
  }
  return { projectId: newProjectId, workflowId }
}

// The transition video model a source project actually ran on. The transition
// activity reads debugSettings.transitionVideoModel with precedence; a source
// without one ran the config default.
export function resolveSourceTransitionVideoModel(sourceDebugSettings: DebugSettings): string {
  return typeof sourceDebugSettings.transitionVideoModel === 'string'
    ? sourceDebugSettings.transitionVideoModel
    : getDefaultVideoModelId()
}

// Seed the new project row through the same createProject precedent the normal
// start path uses (resolveLongTakeProjectId), plus rerunFrom lineage so storage
// lands in storage alongside the copied artifacts.
export async function createSeededRegenerateProject(
  deps: RegenerateLongTakeDeps,
  source: ProjectForBackend,
  sourceProjectId: string,
  options: CreateSeededRegenerateProjectOptions,
): Promise<string> {
  const { styleOverride, transitionVideoModel } = options
  const modelSelectorTier = options.modelSelectorTier ?? source.modelSelectorTier
  const longTakeRatio = normalizeRatio(source.longTakeRatio)
  // Persisted on the row but not yet on ProjectForBackend (same lag as the
  // createProject write side).
  const createUseCase = (source as { createUseCase?: null | string }).createUseCase
  const sourceRow = await deps.prisma.uipSession
    .findUnique({ where: { projectId: sourceProjectId } })
    .catch((error: unknown) => {
      deps.logger.warn(
        `[long-take-regenerate] failed to read uip history for ${sourceProjectId}: ${ensureError(error).message}`,
      )
      return null
    })
  // isUip must track whether a session will actually be seeded. A row whose
  // timeline cannot be read would otherwise leave the project flagged UIP with
  // no session behind it, so the chat-history entry shows and its fetch 404s.
  const sourceSession =
    sourceRow && hasReadableTimeline(deps, sourceRow.timeline) ? sourceRow : null
  const project = await deps.projectsService.createProject(
    {
      ...(source.bgmEnabled == null ? {} : { bgmEnabled: source.bgmEnabled }),
      ...(source.bgmNote ? { bgmNote: source.bgmNote } : {}),
      ...(source.bgmSource ? { bgmSource: source.bgmSource } : {}),
      ...(source.bgmTrackId ? { bgmTrackId: source.bgmTrackId } : {}),
      ...(source.cameraStyle ? { cameraStyle: sanitizeCameraStyle(source.cameraStyle) } : {}),
      ...(createUseCase ? { createUseCase } : {}),
      ...(source.debugSettings ? { debugSettings: source.debugSettings } : {}),
      enableCaption: source.enableCaption ?? false,
      initialText: source.initPrompt ?? '',
      isLongTake: true,
      longTakeInput: source.longTakeInput ?? 'transcript',
      ...(longTakeRatio ? { longTakeRatio } : {}),
      ...(modelSelectorTier ? { modelSelectorTier } : {}),
      ...buildSeededStyleFields(source, styleOverride),
      ...(source.voiceOverJson ? { voice: source.voiceOverJson } : {}),
    },
    { ...(sourceSession ? { isUip: true } : {}), rerunFrom: sourceProjectId },
  )
  if (sourceSession) {
    await seedUipHistorySession(deps, project.id, sourceSession, {
      modelSelectorTier,
      sourceProjectId,
      styleOverride,
      transitionVideoModel,
    })
  }
  return project.id
}

function hasReadableTimeline(deps: RegenerateLongTakeDeps, timeline: unknown): boolean {
  try {
    normalizeTimeline(timeline)
    return true
  } catch (error) {
    deps.logger.warn(
      `[long-take-regenerate] unreadable uip timeline, skipping history seed: ${ensureError(error).message}`,
    )
    return false
  }
}

// Chat history is not worth failing a paid regenerate over, so seeding is
// best-effort: a duplicate-projectId collision or any other DB error is
// logged and swallowed rather than thrown out of createSeededRegenerateProject.
// nextAction is excluded because it is the durable idempotent-delivery
// record for trigger-next-action -- copying it could re-fire the source's
// pending orchestration under the new id.
async function seedUipHistorySession(
  deps: RegenerateLongTakeDeps,
  newProjectId: string,
  sourceSession: NonNullable<
    Awaited<ReturnType<RegenerateLongTakeDeps['prisma']['uipSession']['findUnique']>>
  >,
  marker: {
    modelSelectorTier?: ProjectForBackend['modelSelectorTier']
    sourceProjectId: string
    styleOverride: SeededStyleOverride | undefined
    transitionVideoModel: string
  },
): Promise<void> {
  try {
    // Validate with the same normalizer getSession reads through, so a row we
    // write is one that endpoint can serve.
    const file = normalizeTimeline(sourceSession.timeline)
    const content = marker.styleOverride
      ? `Restyled from ${marker.sourceProjectId} as "${marker.styleOverride.styleName}".`
      : `Regenerated from ${marker.sourceProjectId} with ${marker.transitionVideoModel}.`
    const timeline: TimelineFile = {
      events: [
        ...file.events,
        {
          content,
          id: file.next_event_id,
          ts: new Date().toISOString(),
          type: 'assistant_message',
        },
      ],
      next_event_id: file.next_event_id + 1,
      version: file.version,
    }
    await deps.prisma.uipSession.create({
      data: {
        aspectRatio: sourceSession.aspectRatio,
        entryUseCase: sourceSession.entryUseCase,
        imageModel: sourceSession.imageModel,
        modelSelectorTier: marker.modelSelectorTier ?? sourceSession.modelSelectorTier,
        lockedAt: null,
        phase: sourceSession.phase,
        projectId: newProjectId,
        specVersion: sourceSession.specVersion,
        state: {} as object as InputJsonValue,
        stateVersion: 0,
        status: 'completed',
        timeline: timeline as object as InputJsonValue,
        transitionVideoModel: marker.transitionVideoModel,
        voiceId: sourceSession.voiceId,
      },
    })
  } catch (error) {
    deps.logger.warn(
      `[long-take-regenerate] failed to seed uip history for ${newProjectId}: ${ensureError(error).message}`,
    )
  }
}

// The new project's three style fields: the source's by default (regenerate
// reruns the same look), or wholly the requested style when a restyle overrides
// them. An override with no thumbnail deliberately leaves the field unset rather
// than inheriting the source's - the old thumbnail would mislabel the new style.
function buildSeededStyleFields(
  source: ProjectForBackend,
  styleOverride: SeededStyleOverride | undefined,
): Record<string, unknown> {
  if (!styleOverride) {
    return {
      ...(source.styleName ? { styleName: source.styleName } : {}),
      ...(source.styleText ? { styleText: source.styleText } : {}),
      ...(source.styleThumbnailUrl ? { styleThumbnailUrl: source.styleThumbnailUrl } : {}),
    }
  }
  return {
    styleName: styleOverride.styleName,
    styleText: styleOverride.styleText,
    ...(styleOverride.styleThumbnailUrl
      ? { styleThumbnailUrl: styleOverride.styleThumbnailUrl }
      : {}),
  }
}

function isRetryableStage(stage: ProjectStage | undefined): boolean {
  return stage === PROJECT_STAGE.FAILED || stage === PROJECT_STAGE.CANCELED
}

// Resolve the source project and which regenerate mode it qualifies for, or
// throw.
export async function loadEligibleSourceProject(
  deps: RegenerateLongTakeDeps,
  sourceProjectId: string,
): Promise<{ mode: RegenerateMode; source: ProjectForBackend }> {
  if (!(await deps.projectsService.canVisitProject(sourceProjectId))) {
    throw new UnauthorizedException('You are not authorized to access this project')
  }
  const source = await deps.projectsService.getProject(sourceProjectId)
  if (!source) {
    throw new BadRequestException('Project not found')
  }
  if (!source.isLongTake) {
    throw new BadRequestException('Only a story mode project can be regenerated')
  }
  if (source.resultVideo) {
    return { mode: 'completed', source }
  }
  if (isRetryableStage(source.stage) && (await hasReusableLongTakeArtifacts(sourceProjectId))) {
    return { mode: 'retry', source }
  }
  throw new BadRequestException('Only a completed story mode project can be regenerated')
}

// A failed/cancelled run can be re-driven from its own artifacts only if it got
// far enough to persist all three the workflow reads: keyframes.json +
// shot_plan.json (reused) and the voiceover mp3 (render mixes it). Any missing
// => the run died before/in planning and the caller must remix instead. The
// workflow keeps its own loud guards; this is the cheap up-front gate so we
// never start a doomed retry.
async function hasNonEmptyKeyframeManifest(storage: ProjectStore): Promise<boolean> {
  try {
    const keyframes = await storage.readJsonFile<unknown[]>(LONG_TAKE_KEYFRAMES_PATH)
    return Array.isArray(keyframes) && keyframes.length > 0
  } catch {
    return false
  }
}

async function hasReusableLongTakeArtifacts(sourceProjectId: string): Promise<boolean> {
  const storage = new ProjectStore(sourceProjectId)
  const voiceoverExists = await storage.exists(STORY_LOADER_PATHS.audioVoiceoverPath)
  if (!voiceoverExists) {
    return false
  }
  // Both reused manifests must be present AND usable, not merely existent: an
  // empty/corrupt keyframes.json (copy guard) or a shot plan with no usable
  // time_range (duration) would pass an existence check but then fail the
  // regenerate call, surfacing an error instead of the clean "not eligible ->
  // remix" fallback. Validate them here so the decision stays up front.
  const [hasKeyframes, shotPlanDuration] = await Promise.all([
    hasNonEmptyKeyframeManifest(storage),
    readShotPlanDurationSeconds(storage),
  ])
  return hasKeyframes && shotPlanDuration > 0
}

// The video length in seconds from the shot plan's last time_range.end - the
// same value the workflow re-measures from the voiceover. Returns 0 (not
// eligible / no measurable duration) for a missing, empty, or corrupt plan.
async function readShotPlanDurationSeconds(storage: ProjectStore): Promise<number> {
  try {
    const shots = await storage.readJsonFile<ShotPlanTiming[]>(LONG_TAKE_SHOT_PLAN_PATH)
    if (!Array.isArray(shots) || shots.length === 0) {
      return 0
    }
    return shots.reduce((max, shot) => Math.max(max, shot?.time_range?.end ?? 0), 0)
  } catch {
    return 0
  }
}

// A completed rerun prices off the rendered video length (Project.duration). A retry has
// no rendered video (duration is null until first render), so derive it from the
// shot plan instead.
export async function resolveRegenerateDurationSeconds(
  mode: RegenerateMode,
  source: ProjectForBackend,
  sourceProjectId: string,
): Promise<number> {
  const durationSeconds =
    mode === 'completed'
      ? (source.duration ?? 0)
      : await readShotPlanDurationSeconds(new ProjectStore(sourceProjectId))
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new BadRequestException('Source project duration is unavailable')
  }
  return durationSeconds
}

// Whether the failed/cancelled Retry entry should regenerate (reuse artifacts)
// or fall back to a full remix. Mirrors loadEligibleSourceProject's gate but
// returns a boolean instead of throwing, so the FE can route before charging.
export async function resolveLongTakeRetryEligibility(
  deps: RegenerateLongTakeDeps,
  sourceProjectId: string,
): Promise<{ canRegenerate: boolean }> {
  if (!(await deps.projectsService.canVisitProject(sourceProjectId))) {
    throw new UnauthorizedException('You are not authorized to access this project')
  }
  const source = await deps.projectsService.getProject(sourceProjectId)
  if (!source || !source.isLongTake) {
    return { canRegenerate: false }
  }
  if (source.resultVideo) {
    return { canRegenerate: true }
  }
  const canRegenerate =
    isRetryableStage(source.stage) && (await hasReusableLongTakeArtifacts(sourceProjectId))
  return { canRegenerate }
}

// Carry the source's model badges, the target transition model override, the
// caption look the user chose, and the settled BGM bed onto the new row so the
// editor and any later regenerate read the same state a normal generation would
// have persisted.
//
// Returns the bed the new project actually owns, so the workflow start below
// sends the SAME object the row now advertises rather than re-reading the
// source's.
export async function persistRegenerateSeedFields(
  deps: RegenerateLongTakeDeps,
  params: {
    newProjectId: string
    /**
     * Called the instant the bed copy lands, BEFORE the row writes below. The
     * return value cannot carry this: if a row write throws, the caller never
     * receives it and the unwind cannot delete an object this run created.
     */
    onBedCarried?: (fileUri: string) => void
    source: ProjectForBackend
    sourceProjectId: string
    targetModel: string
    userSub: string
  },
): Promise<{ bgmBedUri: string | undefined }> {
  const { newProjectId, onBedCarried, source, sourceProjectId, targetModel, userSub } = params
  const bgmBed = await carrySourceBgmBed(deps, {
    newProjectId,
    source,
    sourceProjectId,
  })
  if (bgmBed.carriedUri) {
    onBedCarried?.(bgmBed.carriedUri)
  }
  await deps.projectsService.internalUpdateProject(
    newProjectId,
    {
      ...(bgmBed.cdnUrl ? { bgmBedCdnUrl: bgmBed.cdnUrl } : {}),
      ...(bgmBed.fileUri ? { bgmBedUri: bgmBed.fileUri } : {}),
      ...(source.bgmModel ? { bgmModel: source.bgmModel } : {}),
      ...(source.bgmPrompt ? { bgmPrompt: source.bgmPrompt } : {}),
      ...carriedCaptionStyle(source),
      ...(source.imageModel ? { imageModel: source.imageModel } : {}),
      ...(source.routedImageModel ? { routedImageModel: source.routedImageModel } : {}),
      ...(source.script ? { script: source.script } : {}),
    },
    userSub,
  )
  await persistDebugOverrides(
    { projectsService: deps.projectsService as never },
    { projectId: newProjectId, transitionVideoModel: targetModel, userSub },
  )
  // Lineage: point the source at the new project; the source stays live.
  await deps.prisma.project.update({
    data: { rerunTo: newProjectId },
    where: { id: sourceProjectId },
  })
  // Only surfaced for a source that ALREADY had a `bgmBedUri`. The carry above
  // also repairs a row holding only a `bgmBedCdnUrl`, but feeding that to the
  // workflow would start mixing music into a run that previously rendered without
  // any -- a change in output, which this ticket is not. The row is fixed; the
  // render is untouched.
  // What this run created is reported through `onBedCarried` above rather than
  // here, so the unwind can delete it even when one of the writes below throws.
  return { bgmBedUri: source.bgmBedUri ? bgmBed.fileUri : undefined }
}

/**
 * A caption look the user chose (style, highlight, height, size) is theirs, so the new video
 * keeps it; fields that don't read as a choice are dropped. Nothing chosen carries nothing, and
 * the new video takes its own default. The music level is not carried, as before: the new video
 * starts at the default level.
 */
function carriedCaptionStyle(source: ProjectForBackend): { captionStyle?: CaptionStyleSettings } {
  const captionStyle = readCaptionStyleSettings(source.captionStyle)
  return captionStyle && Object.values(captionStyle).some((value) => value != null)
    ? { captionStyle }
    : {}
}

/**
 * A single object copy fails almost only transiently, and the fallback below
 * is a row that still depends on the source project's files -- so it is worth a
 * couple of cheap retries before accepting that outcome. Deliberately not unbounded: this sits on
 * the synchronous path of a user click.
 */
const BED_COPY_ATTEMPTS = 3
const BED_COPY_RETRY_BASE_MS = 200

async function withCopyRetries<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= BED_COPY_ATTEMPTS; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      lastError = error
      if (attempt < BED_COPY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, BED_COPY_RETRY_BASE_MS * attempt))
      }
    }
  }
  throw ensureError(lastError)
}

/**
 * Copy the source's settled BGM bed into the new project.
 *
 * The bed lives at `projects/{sourceProjectId}/bgm/bed-{sha256}.mp3`, and `bgm/` is
 * NOT one of the two prefixes the regenerate workflow's
 * `copyLongTakeSourceArtifacts` clones (`story_loader` and `long_take`), so
 * without this the derived row advertises a `bgmBedCdnUrl` under an id it does
 * not own, and keeps depending on the source project's folder.
 *
 * Beds are content-hashed and immutable, which is exactly why referencing felt
 * safe -- and why copying is cheap: the destination keeps the same
 * content-addressed name, one project over.
 *
 * Best-effort by design. A failed copy falls back to the source's own
 * references, which is what shipped before this and still resolves for the
 * server-side `store://` read the render performs. Dropping the field instead
 * would silently ship a regenerate with no music, which is a worse outcome than
 * a URL that still points at the source project.
 */
async function carrySourceBgmBed(
  deps: RegenerateLongTakeDeps,
  params: {
    newProjectId: string
    source: ProjectForBackend
    sourceProjectId: string
  },
): Promise<{
  carriedUri: string | undefined
  cdnUrl: string | undefined
  fileUri: string | undefined
}> {
  const { newProjectId, source, sourceProjectId } = params
  const stored = source.bgmBedUri || source.bgmBedCdnUrl
  const fallback = {
    carriedUri: undefined,
    cdnUrl: source.bgmBedCdnUrl || undefined,
    fileUri: source.bgmBedUri || undefined,
  }
  if (!stored) {
    return fallback
  }
  try {
    const carried = await withCopyRetries(() =>
      carrySourceProjectObject(stored, sourceProjectId, newProjectId),
    )
    // null means the value does not name an object under the source project's
    // own prefix, so there is nothing to carry.
    return carried
      ? { carriedUri: carried.fileUri, cdnUrl: carried.cdnUrl, fileUri: carried.fileUri }
      : fallback
  } catch (error) {
    // Error, not warn: every fallback here mints a derived row whose bed still
    // lives in the source project's folder, so it has to be visible rather than
    // buried at warn level with the rest of the noise.
    deps.logger.error(
      `[long-take-regenerate] failed to carry bgm bed from ${sourceProjectId} to ${newProjectId} after ${BED_COPY_ATTEMPTS} attempts, keeping the source reference: ${ensureError(error).message}`,
    )
    return fallback
  }
}

// Best-effort unwind after a post-create failure: drop the carried BGM bed and
// the seeded project so a retry does not accrete orphans. Never throws: the unwind must not mask the original error.
export async function releaseRegenerateResources(
  deps: RegenerateLongTakeDeps,
  params: {
    carriedBgmBedUri?: string
    newProjectId: string
    user: UserInfo
  },
): Promise<void> {
  const { carriedBgmBedUri, newProjectId, user } = params
  // The bed is copied inside persistRegenerateSeedFields, before the workflow
  // start, so a failed start would otherwise strand one object per attempt. `deleteProject` drops the row, not the prefix. Deleting the exact URI
  // this run created (never a prefix) keeps the unwind incapable of touching
  // anything the source still owns.
  if (carriedBgmBedUri) {
    try {
      await deleteStoredFile(carriedBgmBedUri)
    } catch (error) {
      deps.logger.warn(
        `[long-take-regenerate] failed to delete carried bgm bed ${carriedBgmBedUri}: ${ensureError(error).message}`,
      )
    }
  }
  try {
    await deps.projectsService.deleteProject(newProjectId, user)
  } catch (error) {
    deps.logger.warn(
      `[long-take-regenerate] failed to delete seeded project ${newProjectId}: ${ensureError(error).message}`,
    )
  }
}

// Validate the requested model server-side, so an unknown or disabled model
// gets a clean 4xx here instead of a silent fallback run.
export function resolveValidatedTargetModel(requested: string): string {
  const validated = validateVideoModelId(requested)
  if (validated !== requested) {
    throw new ForbiddenException('The requested video model is not available')
  }
  return validated
}

async function startRegenerateWorkflow(
  deps: RegenerateLongTakeDeps,
  params: {
    bgmBedUri?: string
    newProjectId: string
    source: ProjectForBackend
    sourceDebugSettings: DebugSettings
    sourceProjectId: string
    targetModel: string
    user: UserInfo
    workflowId: string
  },
): Promise<void> {
  const { newProjectId, source, sourceDebugSettings, sourceProjectId, targetModel, user } = params
  const aspectRatio = normalizeRatio(source.longTakeRatio)
  const generationResolution = sanitizeGenerationResolution(source.generationResolution)
  // The bed the seed step carried into this project, falling back to the
  // source's own reference when nothing was carried.
  const bgmBedUri = params.bgmBedUri || source.bgmBedUri
  const workflowArgs: Record<string, unknown> = {
    ...(aspectRatio ? { aspectRatio } : {}),
    // Absent bed (or a turned-off toggle) means the run has no BGM.
    ...(source.bgmEnabled && bgmBedUri ? { bgmBedUri } : {}),
    // Without a carried bed the regenerate makes one; the wish goes with it.
    ...(source.bgmEnabled && source.bgmNote ? { bgmNote: source.bgmNote } : {}),
    debugSettings: { ...sourceDebugSettings, transitionVideoModel: targetModel },
    ...buildCameraStyleWorkflowArgs(sanitizeCameraStyle(source.cameraStyle)),
    ...(source.enableCaption == null ? {} : { enableCaption: source.enableCaption }),
    ...(generationResolution ? { generationResolution } : {}),
    hasAudioUpload: source.longTakeInput === 'audio',
    ...(user.orgId ? { orgId: user.orgId } : {}),
    ...(source.modelSelectorTier ? { modelSelectorTier: source.modelSelectorTier } : {}),
    projectId: newProjectId,
    sourceProjectId,
    ...(source.styleText ? { styleText: source.styleText } : {}),
    transitionVideoModel: targetModel,
    userEmail: user.email,
    userId: user.sub,
  }
  await startStandaloneAdmissionWorkflow(deps, createClient as never, buildQueuedAdmissionMeta, {
    resolvedProjectId: newProjectId,
    taskQueue: await resolveStoryModeTaskQueue(),
    user,
    workflowArgs,
    workflowId: params.workflowId,
    workflowName: LONG_TAKE_REGENERATE_WORKFLOW_NAME,
  })
}
