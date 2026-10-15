/**
 * UIP session creation logic.
 *
 * Separated from uip.service.ts to keep that file under the max-lines limit.
 */
import { randomUUID } from 'node:crypto'

import type { InputJsonValue } from '@reelmakeeasy/api-db'
import type { KvStore } from '@reelmakeeasy/common/kv/store'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { parseModelSelectorAnalyticsTier } from '@reelmakeeasy/common/model-config/model-selector-analytics-tier'
import { sanitizeGenerationResolution } from '@reelmakeeasy/common/model-config/story-mode-generation-resolution-config.zod'
import { toSavedAddressesInText } from '@reelmakeeasy/common/storage/address'
import { resolveTaskQueueForClient } from '@reelmakeeasy/common/workflow/task-queue'
import {
  getUipWorkflowId,
  getUipWorkflowType,
  type UipWorkflowVersion,
} from '@reelmakeeasy/common/workflow/uip-workflow-version'
import type { UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'
import {
  CURRENT_WORKFLOW_PROTOCOL_VERSION,
  SHORTENED_SESSION_IDLE_TIMEOUT_MS,
} from '@reelmakeeasy/uip-planner-runtime'
import type { Client } from '@reelmakeeasy/workflow-engine/client'
import { BadRequestException } from '@nestjs/common'
import type { AspectRatio, ProjectVoiceOverJson } from '@shared/types/api/project'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import type { DebugSettings } from '@shared/types/project/debug-settings'

import type { BrandBriefStyleRef } from '../brand-briefs/brand-brief-save'
import type { PrismaService } from '../prisma/prisma.service'
import type { ProjectService } from '../projects/projects.service'

import {
  buildCreateContentFingerprint,
  CONTENT_DEDUPE_TTL_SECONDS,
  CONTENT_RECENT_TTL_SECONDS,
  contentDedupeCacheKey,
  contentRecentCacheKey,
} from './uip-create-content-key'
import { supersedeAutoContinue } from './uip-create-supersede'
import { rewriteMessageAssetIdsToAddresses, rewriteMessageAssetUrls } from './uip-response-helpers'
import type { TimelineEvent, TimelineFile, UipSessionState } from './uip-timeline-types'
import { copyAudioUploadToProject, resolveUploadedAssetsForProject } from './uip-uploaded-assets'
import { assertUipVoiceUsable } from './uip-voice-guard'

const logger = createSubLogger('uip-service')

const UIP_BASE_TASK_QUEUE = 'uip-dev'
const STORY_MODE_BASE_TASK_QUEUE = 'ao-story-mode'

// Create-session idempotency. A create is non-idempotent -- every
// call mints a fresh Project -- so a duplicate/retried request creates a
// duplicate project. We dedupe on the client-supplied sessionCreationId: the
// first request claims the key, creates, then publishes projectId under it;
// duplicates read the published id back and return the same session.
export const CREATE_PENDING_SENTINEL = '__creating__'
// Claim lock TTL: long enough to cover the slowest real create, short enough
// that a crashed owner's stale claim auto-clears so a later retry can re-create.
const CREATE_CLAIM_TTL_SECONDS = 60
// Result TTL: window in which a duplicate/retry returns the same session.
const CREATE_RESULT_TTL_SECONDS = 30 * 60
// A concurrent duplicate (lost the claim race) waits this long for the winner's
// result before giving up and creating its own -- comfortably above normal
// create latency, so a real double-fire almost always converges to one project.
const CREATE_WAIT_MAX_MS = 20_000
const CREATE_WAIT_POLL_INTERVAL_MS = 250
// Session statuses that make a deduped id useless to return. Excludes
// 'completed', which is a legitimate result to hand back.
const UNUSABLE_SESSION_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'failed', 'timed_out'])

export type CreateSessionInput = {
  aspectRatio?: string
  /**
   * Client-measured length of the uploaded audio track in whole seconds.
   * Untrusted (decorators are
   * documentation only) -- guarded by normalizeAudioDurationSeconds at use.
   */
  audioDurationSeconds?: number
  audioPath?: string
  /**
   * Preview transcript of the uploaded audio (FE audio-script-preview). Only
   * feeds the saved-brand-brief matcher below; the session script still comes
   * from the workflow's own ASR of `audioPath`.
   */
  audioTranscript?: string
  /**
   * Initial auto-continue setting for the session. Forwarded to the
   * workflow params; false = no review gate arms an auto-continue / auto-lock
   * timer. Absent = legacy behavior (timers fire). Flippable mid-session via
   * POST /uip-sessions/{id}/auto-continue.
   */
  autoContinueEnabled?: boolean
  // Story-mode "Background music" toggle at creation, gated on
  // enable_bgm by the FE. Forwarded to createProject -> Project.bgmEnabled.
  bgmEnabled?: boolean
  /**
   * Asset staging_uris the user removed from the pre-UIP brand chips.
   * Dropped from the injected brief bank. Only meaningful with `brandBriefId`.
   */
  brandBriefExcludedAssetUris?: string[]
  /**
   * Brief the user explicitly selected in the submission box (Branding V2 M1).
   * When set and `enable_saved_brand` is on, the brief is injected
   * pre-locked as the session's brand_bank (the explicit-selection path), in
   * place of the retired prompt auto-detection. Forwarded from the request
   * DTO's `brand_brief_id`.
   */
  brandBriefId?: string
  customStyle?: boolean
  /**
   * Debug panel model-switch override, pre-sanitized by the
   * controller to carry only a well-formed `llm` map. Forwarded to
   * `createProject`, which persists it onto `Project.debugSettings` (and derives
   * `Project.modelSwitch`) so the UIP transition stage honors the switch.
   */
  debugSettings?: DebugSettings
  enableCaption?: boolean
  /**
   * Creation tab / entry use case the session was started from (web
   * `CreateUseCaseKey`, e.g. 'song-to-video'). Persisted on UipSession.
   * Untrusted: sanitized before persist.
   */
  entryUseCase?: string
  /** Raw client generation-resolution setting; sanitized before persist. */
  generationResolution?: Record<string, unknown>
  imageModel?: string
  initialMessage?: string
  /**
   * Entry-point music declaration from the song-to-video front door
   * (`is_music` on the request DTO). Threaded onto workflow params only when
   * the session carries uploaded audio.
   */
  isMusic?: boolean
  loginId: string
  modelSelectorTier?: ModelSelectorAnalyticsTier
  orgId: string
  /**
   * Client capability marker: true iff the submitting client
   * reconciled the brand-brief selector against the remix source (adopt/empty)
   * before this submission. Forwarded from the DTO's `remix_brand_aware`; read
   * by the remix brand-carry qualification, dormant until that lands. Absent
   * from old bundles, gate-off orgs, and fast submits that beat the
   * carry-context response -- all of which must keep legacy carry behavior.
   */
  remixBrandAware?: boolean
  /**
   * Source project ID when this UIP session is being created via Remix.
   * Caller (controller) forwards this from the request DTO's
   * `remix_project_id` field. When the source is viewable (`canViewProject` --
   * owner/share OR a public long-take) it is used to build a
   * deterministic carry-over summary of the source's UIP spec
   * (`summarizeRemixSource`) that is threaded into `remixContext`; otherwise
   * carry-over is skipped (never blocks submit).
   */
  remixProjectId?: string
  seedStyleInstruction?: {
    style_image_uri?: string
    style_name: string
    style_text: string
    style_thumbnail_url: string
  }
  /**
   * Reference to the style the user picked pre-UIP (preset slug / saved custom
   * id). Persisted on the session and read at brand-review confirm so a saved
   * brief points at the library style. Mongo-only; not a workflow param.
   */
  selectedStyleRef?: BrandBriefStyleRef
  /**
   * Client-generated idempotency key for the create request. One id
   * is minted per planner open and reused across style tweaks / retries, so a
   * duplicate/retried create (double-submit, slow-network re-submit, multi-tab)
   * returns the already-created session instead of minting a second Project.
   * Absent on legacy clients -- creation then behaves exactly as before.
   */
  sessionCreationId?: string
  /**
   * Composer's style seed mode (spec, "preset-only" V1). Forwarded
   * from `CreateUipSessionDto.style_mode`; the API forces 'manual' when the
   * `auto_style_selection` gate is off, regardless of this value. Absent =
   * 'manual' (legacy pre-feature behavior). Task 13 wires the real composer
   * value -- this field is plumbed ahead of that.
   */
  styleMode?: 'auto' | 'manual'
  transitionVideoModel?: string
  uploadedAssets?: Array<{
    asset_id: string
    content_type: string
    file_name: string
    file_path: string
    uploaded_at?: string
  }>
  userEmail: string
  userId: string
  voice?: ProjectVoiceOverJson
}

export type CreateUipSessionDeps = {
  getWorkflowClient: () => Promise<Client>
  /**
   * KV store for create-session idempotency. Dedupes duplicate/retried
   * creates that carry the same sessionCreationId onto a single Project.
   * Optional: always injected in prod (globally provided), but absent means the
   * guard degrades to a plain create -- same fail-open path as a store error.
   */
  kv?: Pick<KvStore, 'del' | 'get' | 'set' | 'setNX'>
  prisma: PrismaService
  projectService: ProjectService
  /**
   * Signal a running UIP workflow. Used only to park auto-continue on a session
   * this create supersedes. Optional for the same reason as
   * `kv`: absent simply skips the parking, and it keeps the existing
   * unit-test constructions of these deps untouched.
   */
  signalWorkflow?: (projectId: string, signal: string, payload: unknown) => Promise<void>
}

export function assertImageUploadedAssets(
  assets:
    | Array<{
        asset_id: string
        content_type: string
        file_name: string
        file_path: string
        uploaded_at?: string
      }>
    | undefined,
  fieldName: string,
): void {
  for (const asset of assets ?? []) {
    if (!asset.content_type?.startsWith('image/')) {
      throw new BadRequestException(
        `Only image uploads are allowed in ${fieldName}. Unsupported content_type: ${asset.content_type}`,
      )
    }
  }
}

/**
 * Guard the client-supplied audio duration. The DTO decorators are
 * documentation only (no global ValidationPipe), so validate here: a finite
 * positive number, rounded to whole seconds; anything else -> undefined so the
 * workflow seeds null and the FE falls back to re-measuring.
 */
function normalizeAudioDurationSeconds(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return Math.round(value)
}

function sessionCreationCacheKey(orgId: string | undefined, sessionCreationId: string): string {
  return `uip:create-session:${orgId ?? 'no-org'}:${sessionCreationId}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Poll the cache key for the claim owner's published session id. Returns the id
 * once the owner finishes, or undefined if the owner released the claim (create
 * failed -> key deleted) or never published within CREATE_WAIT_MAX_MS -- in
 * which case the caller falls through and creates its own session (a duplicate
 * here is far rarer than the double-create this guard prevents).
 */
async function waitForConcurrentCreate(
  kv: Pick<KvStore, 'get'>,
  cacheKey: string,
): Promise<string | undefined> {
  const attempts = Math.floor(CREATE_WAIT_MAX_MS / CREATE_WAIT_POLL_INTERVAL_MS)
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await kv.get(cacheKey)
    if (value === null) {
      // Owner released the claim (its create failed) -- create our own.
      return undefined
    }
    if (value !== CREATE_PENDING_SENTINEL) {
      return value
    }
    await sleep(CREATE_WAIT_POLL_INTERVAL_MS)
  }
  return undefined
}

/**
 * Session creation with two independent duplicate guards, outermost first:
 *
 *   1. Content identity -- keyed on what the request *is*, so it
 *      catches a second submit of the same composition from any tab, reload, or
 *      freshly-minted creation id. Also parks auto-continue on the session this
 *      one supersedes, which is what stops an abandoned duplicate billing.
 *   2. Creation id -- keyed on the client-supplied `sessionCreationId`,
 *      which is single-use, so it only covers a retried *in-flight/failed* create.
 *
 * Both fail open: no key, or any store error, degrades to a plain un-deduped
 * create. The store must never gate session creation.
 */
export async function createUipSession(
  input: CreateSessionInput,
  deps: CreateUipSessionDeps,
): Promise<{ session_id: string }> {
  // A Gemini voice without GEMINI_API_KEY: refuse in the voice list's words, before anything runs.
  assertUipVoiceUsable(input.voice?.voiceId)
  return withContentGuard(input, deps, () => createUipSessionForCreationId(input, deps))
}

/**
 * Content-identity guard. Deliberately a sibling of the idempotency
 * guard below rather than a shared abstraction: the two differ in key derivation
 * and result TTL, and folding them together would rewrite proven idempotency
 * code for no behavioural gain. Same protocol -- fast path, SETNX claim, wait
 * for a concurrent winner, publish on success, release on failure.
 */
async function withContentGuard(
  input: CreateSessionInput,
  deps: CreateUipSessionDeps,
  run: () => Promise<{ session_id: string }>,
): Promise<{ session_id: string }> {
  const { kv } = deps
  const fingerprint = kv ? buildCreateContentFingerprint(input) : undefined
  if (!kv || !fingerprint) {
    return run()
  }

  const cacheKey = contentDedupeCacheKey(input.orgId, input.userId, fingerprint)
  try {
    const cached = await kv.get(cacheKey)
    if (cached && cached !== CREATE_PENDING_SENTINEL) {
      // Never hand back a session the user can no longer use: a create that
      // succeeded and then failed/cancelled would otherwise block their retry for
      // the whole window. Drop the claim and create instead.
      if (await isSessionReusable(deps.prisma, cached)) {
        logger.info(`[${cached}] Reusing UIP session for identical create content`)
        return { session_id: cached }
      }
      logger.info(`[${cached}] Superseding an unusable deduped session; creating a new one`)
      kv.del(cacheKey)
    }
    const claimed = await kv.setNX(cacheKey, CREATE_PENDING_SENTINEL, CREATE_CLAIM_TTL_SECONDS)
    if (!claimed) {
      const resolved = await waitForConcurrentCreate(kv, cacheKey)
      if (resolved) {
        logger.info(`[${resolved}] Reusing UIP session for identical create content`)
        return { session_id: resolved }
      }
      // Owner never published within our wait budget -- fall through and create.
    }
  } catch (err) {
    logger.warn(`UIP create content guard degraded (store error): ${err}`)
    return run()
  }

  return publishContentClaim(input, deps, { cacheKey, fingerprint }, run)
}

/**
 * Run the create under a held content claim: publish the session id on success so
 * later duplicates dedupe, release the claim on failure so a genuine retry can
 * re-create, then advance the supersede pointer.
 */
async function publishContentClaim(
  input: CreateSessionInput,
  deps: CreateUipSessionDeps,
  keys: { cacheKey: string; fingerprint: string },
  run: () => Promise<{ session_id: string }>,
): Promise<{ session_id: string }> {
  const { kv } = deps
  if (!kv) {
    return run()
  }

  let result: { session_id: string }
  try {
    result = await run()
  } catch (err) {
    kv.del(keys.cacheKey)
    throw err
  }
  kv.set(keys.cacheKey, result.session_id, CONTENT_DEDUPE_TTL_SECONDS)
  await parkSupersededSession(input, deps, keys.fingerprint, result.session_id)
  return result
}

/**
 * Whether a deduped session is still something the user can act on. A missing row
 * (project deleted) or a terminal-failure status means the cached id is a dead
 * end. `completed` counts as reusable -- it is a real result to hand back, and a
 * session cannot realistically finish inside the dedupe window anyway.
 *
 * Fails open (treats the session as reusable) on a lookup error: an unavailable
 * database must not turn the guard into a duplicate-project generator.
 */
async function isSessionReusable(prisma: PrismaService, projectId: string): Promise<boolean> {
  try {
    const session = await prisma.uipSession.findUnique({
      select: { status: true },
      where: { projectId },
    })
    if (!session) {
      return false
    }
    return !UNUSABLE_SESSION_STATUSES.has(session.status)
  } catch (err) {
    logger.warn(`[${projectId}] Could not verify deduped session status, reusing it: ${err}`)
    return true
  }
}

/**
 * Advance the content -> most-recent-session pointer and park whatever it named
 * before. Read-then-write rather than a claim: the loser of a race
 * simply re-parks an already-parked session, which is idempotent. Runs only
 * after a successful create, and never propagates a failure -- the user's
 * session already exists by this point.
 *
 * The pointer writes happen first (two in-memory store ops, and the
 * pointer must be correct before the next create reads it). The park itself is
 * deliberately **not** awaited: it signals the workflow and takes a session lock on
 * a *different* project, which would otherwise add that latency to the create
 * response for no benefit to the caller. It swallows its own failures.
 */
async function parkSupersededSession(
  input: CreateSessionInput,
  deps: CreateUipSessionDeps,
  fingerprint: string,
  newProjectId: string,
): Promise<void> {
  const { prisma, kv, signalWorkflow } = deps
  if (!kv) {
    return
  }
  const recentKey = contentRecentCacheKey(input.orgId, input.userId, fingerprint)
  let previousProjectId: null | string = null
  try {
    previousProjectId = await kv.get(recentKey)
    await kv.set(recentKey, newProjectId, CONTENT_RECENT_TTL_SECONDS)
  } catch (err) {
    logger.warn(`UIP supersede pointer degraded (store error): ${err}`)
  }
  if (previousProjectId && previousProjectId !== newProjectId) {
    // Intentionally not awaited -- see the note above. supersedeAutoContinue
    // never rejects, so the extra catch is belt-and-braces for the floating promise.
    void supersedeAutoContinue(previousProjectId, newProjectId, { prisma, signalWorkflow }).catch(
      (err: unknown) => {
        logger.warn(`[${previousProjectId}] Superseding auto-continue failed: ${err}`)
      },
    )
  }
}

/**
 * Idempotency guard around session creation. Without a
 * sessionCreationId the create runs unchanged (legacy clients). With one:
 *   1. Fast path -- return the already-created session if the id was seen.
 *   2. Claim the id (SETNX). If we lose the race, wait for the winner's result.
 *   3. Create; publish projectId under the id so later duplicates dedupe;
 *      release the claim on failure so a genuine retry can re-create.
 */
async function createUipSessionForCreationId(
  input: CreateSessionInput,
  deps: CreateUipSessionDeps,
): Promise<{ session_id: string }> {
  const { kv } = deps
  const sessionCreationId = input.sessionCreationId?.trim()
  if (!sessionCreationId || !kv) {
    return runCreateUipSession(input, deps)
  }

  const cacheKey = sessionCreationCacheKey(input.orgId, sessionCreationId)

  // Fail-open: any store error degrades to a plain (un-deduped) create rather
  // than blocking session creation -- the store must never gate the create path.
  try {
    const cached = await kv.get(cacheKey)
    if (cached && cached !== CREATE_PENDING_SENTINEL) {
      logger.info(`[${cached}] Reusing UIP session for creation id ${sessionCreationId}`)
      return { session_id: cached }
    }
    const claimed = await kv.setNX(cacheKey, CREATE_PENDING_SENTINEL, CREATE_CLAIM_TTL_SECONDS)
    if (!claimed) {
      const resolved = await waitForConcurrentCreate(kv, cacheKey)
      if (resolved) {
        logger.info(`[${resolved}] Reusing UIP session for creation id ${sessionCreationId}`)
        return { session_id: resolved }
      }
      // Owner never published within our wait budget -- fall through and create.
    }
  } catch (err) {
    logger.warn(`UIP create idempotency guard degraded (store error): ${err}`)
    return runCreateUipSession(input, deps)
  }

  let result: { session_id: string }
  try {
    result = await runCreateUipSession(input, deps)
  } catch (err) {
    // Release the claim so a genuine retry with the same id can re-create
    // instead of waiting on (or being deduped by) a dead reservation.
    kv.del(cacheKey)
    throw err
  }
  kv.set(cacheKey, result.session_id, CREATE_RESULT_TTL_SECONDS)
  return result
}

async function runCreateUipSession(
  input: CreateSessionInput,
  deps: CreateUipSessionDeps,
): Promise<{ session_id: string }> {
  const { getWorkflowClient, prisma, projectService } = deps

  const bgmEnabled = input.bgmEnabled

  // Untrusted tab string: trim + length-cap (or drop) so a forged/oversized
  // value can't break the freeze-edge config lookup; reused for both
  // Project.createUseCase and UipSession.entryUseCase so they never diverge.
  const resolvedEntryUseCase = sanitizeEntryUseCase(input.entryUseCase)
  const modelSelectorTier = parseModelSelectorAnalyticsTier(input.modelSelectorTier)

  // Create the project first -- runs IP risk validation and all standard
  // project-creation side effects (analytics, share link, timing).
  // Fail fast before doing any expensive storage work.
  const project = await projectService.createProject(
    {
      initialText: input.initialMessage ?? '',
      voice: input.voice ?? undefined,
      longTakeRatio: (input.aspectRatio as AspectRatio) ?? undefined,
      isLongTake: true,
      modelSelectorTier,
      enableCaption: input.enableCaption,
      bgmEnabled,
      // Debug panel model switch: createProject persists it onto
      // Project.debugSettings and derives Project.modelSwitch. Confirm-time
      // orchestration reads it back and threads it to the transition stage.
      // Passed unconditionally (undefined is a no-op) to match the classic flow.
      debugSettings: input.debugSettings,
      // Persist the entry tab as the project's use case; uses the
      // same sanitized value as UipSession.entryUseCase so the two never diverge.
      ...(resolvedEntryUseCase ? { createUseCase: resolvedEntryUseCase } : {}),
    },
    { stage: PROJECT_STAGE.UIP_PLANNING, isUip: true },
  )
  const projectId = project.id

  // All sessions run the V2 event-log workflow. The
  // version is pinned onto the session state as a forensic/analytics marker; it
  // no longer drives workflow-id routing (getUipWorkflowId is v2-only).
  const workflowVersion: UipWorkflowVersion = 'v2'
  const workflowId = getUipWorkflowId(projectId)

  logger.info(`[${projectId}] Creating UIP session (workflowId=${workflowId})`)
  assertImageUploadedAssets(input.uploadedAssets, 'uploaded_assets')

  const { resolvedAssets, urlMap } = await resolveUploadedAssetsForProject(
    projectId,
    input.uploadedAssets,
  )

  const persistedAudioPath = input.audioPath
    ? (await copyAudioUploadToProject(projectId, input.audioPath))?.destUri
    : undefined
  const sessionAudioPath = persistedAudioPath ?? input.audioPath

  // Saved with the uploads' addresses, never a URL with a host or port: the timeline
  // serves them as URLs when it is sent out.
  const rewrittenInitialMessage = toSavedAddressesInText(
    rewriteMessageAssetIdsToAddresses(
      rewriteMessageAssetUrls(input.initialMessage, urlMap),
      resolvedAssets,
      projectId,
    ),
  )

  const state = {
    workflow_protocol_version: CURRENT_WORKFLOW_PROTOCOL_VERSION,
    workflow_version: workflowVersion,
    phase: 'mode_confirmation',
    status: 'active',
  } satisfies UipSessionState

  let initialMessageId: string | undefined
  let initialMessageSentAt: string | undefined

  const initialEvents: TimelineEvent[] = []
  let next_event_id = 1
  if (rewrittenInitialMessage) {
    initialMessageId = randomUUID()
    initialMessageSentAt = new Date().toISOString()
    initialEvents.push({
      id: next_event_id++,
      type: 'user_message',
      ts: initialMessageSentAt,
      uts: initialMessageSentAt,
      message_id: initialMessageId,
      message: rewrittenInitialMessage,
      uploaded_assets: resolvedAssets,
      status: 'pending',
    })
  }

  const timeline = {
    version: 0,
    next_event_id,
    events: initialEvents,
  } satisfies TimelineFile

  // Never trust the client: keep only valid enum fields.
  const resolvedGenerationResolution = sanitizeGenerationResolution(input.generationResolution)

  // Create the UIP session row and reset the Project row's image model (null =
  // on the default) in a single interactive transaction so the two never drift
  // if the second write fails after the first commits. Regeneration
  // reads the project's current selection from the Project row.
  await prisma.$transaction(async (tx) => {
    await tx.uipSession.create({
      data: {
        projectId,
        timelineVersion: 0,
        phase: state.phase,
        status: state.status,
        specVersion: 0,
        voiceId: input.voice?.voiceId,
        aspectRatio: input.aspectRatio,
        generationResolution: resolvedGenerationResolution as InputJsonValue | undefined,
        modelSelectorTier,
        entryUseCase: resolvedEntryUseCase,
        // Transition video model. NO-CLOBBER INVARIANT: the client
        // value is persisted AS-IS -- the existing Seedance 2.0 transition flow
        // relies on `input.transitionVideoModel` being stored verbatim.
        transitionVideoModel: input.transitionVideoModel,
        customStyle: input.customStyle,
        selectedStyleRef: input.selectedStyleRef
          ? (input.selectedStyleRef as object as InputJsonValue)
          : undefined,
        state: state as object as InputJsonValue,
        timeline: timeline as object as InputJsonValue,
      },
    })
    await tx.project.update({
      where: { id: projectId },
      data: {
        imageModel: null,
        generationResolution: (resolvedGenerationResolution as InputJsonValue | undefined) ?? null,
      },
    })
  })

  const workflowClient = await getWorkflowClient()

  // Resolve task queues: UIP for the parent workflow and story-mode for the
  // pre-voiceover child (audio mode). Each child runs where its activities are
  // registered.
  const [uipTaskQueue, storyModeTaskQueue] = await Promise.all([
    resolveTaskQueueForClient(UIP_BASE_TASK_QUEUE),
    resolveTaskQueueForClient(STORY_MODE_BASE_TASK_QUEUE),
  ])
  const params: UipSessionWorkflowParams = {
    projectId,
    userId: input.userId ?? input.loginId,
    userEmail: input.userEmail,
    articleExtractionEnabled: false,
    consistencyGuardEnabled: false,
    improvedVisualScriptEnabled: false,
    storyModeV3Enabled: false,
    musicVideoImprovementEnabled: false,
    transcriptVoicePreviewEnabled: false,
    // Per-session auto-continue opt-out. Passed through as-is;
    // undefined preserves the workflow's always-on default (foldDeadline only
    // suppresses on an explicit false).
    autoContinueEnabled: input.autoContinueEnabled,
    generationResolution: resolvedGenerationResolution,
    // The tier was already persisted on the UipSession row above for
    // analytics; forward it into the workflow too so the visual-script tool can
    // key its primary model on it.
    modelSelectorTier,
    orgId: input.orgId,
    transitionVideoModel: input.transitionVideoModel,
    initialMessage: rewrittenInitialMessage,
    initialMessageId,
    initialMessageSentAt,
    seedStyleInstruction: input.seedStyleInstruction,
    // The composer's style mode is ignored: every session seeds its style manually.
    styleMode: 'manual',
    autoStyleEnabled: false,
    uploadedAssets: resolvedAssets as UipSessionWorkflowParams['uploadedAssets'],
    audioPath: sessionAudioPath,
    // Client-measured track length. Carried on the params for audio
    // sessions; the runtime ASR remains the source of mode_state.duration_seconds.
    audioDurationSeconds: normalizeAudioDurationSeconds(input.audioDurationSeconds),
    // Entry tab for the planner, pinned onto LLM-visible
    // spec.meta.entry_use_case -- allowlisted, unlike the free-form value
    // persisted above.
    entryUseCase: resolveWorkflowEntryUseCase(resolvedEntryUseCase),
    isMusic: input.isMusic === true && Boolean(sessionAudioPath),
    voiceId: input.voice?.voiceId,
    voiceProfile: project.voiceOverJson?.voiceProfile,
    storyModeTaskQueue,
    brandExtractionEnabled: false,
    workflowProtocolVersion: CURRENT_WORKFLOW_PROTOCOL_VERSION,
  }

  await workflowClient.workflow.start(getUipWorkflowType(), {
    args: [params],
    workflowId,
    taskQueue: uipTaskQueue,
    // Hard backstop independent of the in-workflow idle gate (3h),
    // which is signal-resettable and can be bypassed via auto-extending
    // deadlines. 1.5x the idle timeout = 4.5h: strictly > 3h so
    // graceful in-workflow exit wins the common case; tight enough that
    // abandoned sessions cost ~4.5h of wall-clock.
    workflowExecutionTimeout: SHORTENED_SESSION_IDLE_TIMEOUT_MS * 1.5,
  })

  logger.info(`[${projectId}] UIP workflow started`)
  return { session_id: projectId }
}

/**
 * Sanitize the client-supplied creation tab before persisting it.
 * Returns a trimmed value only for a plausible tab id (non-empty,
 * length-capped); anything else => undefined. Not an allowlist. The
 * workflow-params path is stricter -- it
 * additionally requires a known tab id (WORKFLOW_ENTRY_USE_CASES) because that
 * value reaches the planner LLM prompt.
 */
export function sanitizeEntryUseCase(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : undefined
}

/**
 * Creation-tab ids allowed onto UIP workflow params. The sanitized
 * entryUseCase stays free-form, but the workflow pins this value into `spec.meta.entry_use_case`,
 * which is serialized into the planner LLM context every turn -- so only known
 * tab ids may cross that boundary. Keep in sync with the web CreateUseCaseKey
 * union (apps/web/src/constants/create-use-cases.ts); an unlisted tab degrades
 * to "no entry tab" for the planner, never to injected free text.
 */
const WORKFLOW_ENTRY_USE_CASES: ReadonlySet<string> = new Set([
  'animation-style-ad',
  'audio-to-video',
  'news-article-to-video',
  'script-to-video',
  'song-to-video',
])

/** Apply the WORKFLOW_ENTRY_USE_CASES gate to a sanitized entry tab. */
function resolveWorkflowEntryUseCase(sanitized: string | undefined): string | undefined {
  return sanitized && WORKFLOW_ENTRY_USE_CASES.has(sanitized) ? sanitized : undefined
}
