import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import type { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'

import { LONG_TAKE_PROMPT_ROUTES, type LongTakePromptRoute } from '../../long-take-prompt-router'
import type {
  CopyLongTakeSourceArtifactsActivityParams,
  CopyLongTakeSourceArtifactsActivityResult,
  LoadLongTakeRegenerateInputsActivityParams,
  LoadLongTakeRegenerateInputsActivityResult,
  LongTakeKeyframeItem,
  LongTakeShotPlanItem,
} from '../../workflows/long-take/types'

import {
  downloadAssetToLocal,
  formatError,
  formatLogFields,
  getVideoDurationSeconds,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import {
  createLongTakeStorage,
  LONG_TAKE_PIPELINE_CONTEXT_PATH,
  LONG_TAKE_PROMPT_ROUTE_CLASSIFICATION_PATH,
} from './storage'
import { copyStoredFolder } from '@reelmakeeasy/common/storage/stored-files'

export const LONG_TAKE_SHOT_PLAN_PATH = 'long_take/shot_plan.json'
export const LONG_TAKE_KEYFRAMES_PATH = 'long_take/keyframes.json'
// The two prefixes that hold every generated artifact for a long-take project.
// Cloning both makes the regenerate target a complete, editable copy of the
// source. story_loader carries the voiceover (both the mp3 the render mixes and
// the m4a the editor streams as audioPreviewUrl), visual script, transcript and
// script; long_take carries the shot plan, keyframes + images, anchors and the
// experts asset manifest that the assets report and editor read.
const STORY_LOADER_DIR = 'story_loader'
const LONG_TAKE_DIR = 'long_take'
/**
 * The trees this activity clones, and therefore the only prefixes whose URIs may
 * be repointed at the new project: a URI is only safe to rewrite when an object
 * actually exists at the rewritten path.
 */
const COPIED_ARTIFACT_DIRS = [LONG_TAKE_DIR, STORY_LOADER_DIR] as const

/**
 * Clone the source project's generated-artifact tree into the new project's
 * prefix so the regenerate target is a complete, editable copy: only the
 * transition videos and final render are produced fresh by the workflow
 * (overwriting any copied originals). Copying the full story_loader and
 * long_take trees (rather than a hand-picked file list) keeps the viewer,
 * editor and assets report working the same as on the source, and is why the
 * editor audio track (voice_over.m4a) and the assets manifest are present.
 */
export async function copyLongTakeSourceArtifacts(
  params: CopyLongTakeSourceArtifactsActivityParams,
): Promise<CopyLongTakeSourceArtifactsActivityResult> {
  const { projectId, sourceProjectId, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      if (!sourceProjectId || sourceProjectId === projectId) {
        throw new Error('Regenerate requires a source project different from the target project')
      }

      const startedAt = Date.now()
      const sourceStorage = createLongTakeStorage(sourceProjectId)
      const storage = createLongTakeStorage(projectId)

      // Snapshot the source BEFORE copying, and hold the completeness check to
      // this snapshot. Listing the source afterwards instead would make any object
      // written to the still-live source mid-copy look like a failed copy, and
      // hard-fail a paid regenerate over a race the copy handled correctly. An
      // object that raced IN is simply not expected here; `copyFolderFromStorage`
      // does its own listing and copies it anyway, so the target is a superset.
      const expectedFiles = await listClonedTreeFiles(sourceStorage)

      await storage.copyFolderFromStorage(sourceStorage, STORY_LOADER_DIR)
      await storage.copyFolderFromStorage(sourceStorage, LONG_TAKE_DIR)

      // Prove the clone landed BEFORE anything is repointed. `copyFolderFromStorage`
      // logs-and-swallows every per-file failure and returns normally on an empty
      // source listing, so "it resolved" says nothing about what is in the target.
      // That mattered little while only keyframe-image URIs were rewritten; now that
      // the sweep spans both whole trees, a file that silently failed to copy would
      // have its reference rewritten from a source path that EXISTS to a target path
      // that does NOT -- a hard 404, strictly worse than leaving it pointing at the
      // source project. Compare the full file-NAME sets and fail loudly instead.
      const targetFiles = await assertClonedTreesComplete(storage, {
        expectedFiles,
        projectId,
        sourceProjectId,
      })

      // The copied manifests carry absolute URIs pointing back at the SOURCE
      // project. Repoint every one that names an object under a prefix this
      // activity just cloned, so the new project references its OWN copies.
      const { repointedFileCount, skippedFileCount } = await repointCopiedArtifactManifests(
        storage,
        {
          manifestPaths: targetFiles.filter((filePath) => filePath.endsWith('.json')),
          projectId,
          sourceProjectId,
        },
      )

      // Read AFTER the repoint, so the guard sees exactly what the workflow will.
      const keyframes = await storage.readJsonFile<LongTakeKeyframeItem[]>(LONG_TAKE_KEYFRAMES_PATH)
      if (!Array.isArray(keyframes) || keyframes.length === 0) {
        throw new Error(`Source project ${sourceProjectId} has no keyframes to reuse`)
      }
      // A non-empty array is satisfied by the UN-repointed copy, so length alone
      // cannot tell a successful repoint from one the per-file catch swallowed.
      // Assert the invariant itself and let the activity retry: a keyframes.json still
      // addressing the source is the exact defect this activity exists to prevent,
      // and it is the one file every downstream stage reads. Checked against the
      // whole `projects/{sourceProjectId}/` prefix rather than one dir -- every URI this
      // file carries (keyframeUrl, thumbnailUrl) is written under `long_take/`, so
      // any residue at all is a repoint failure.
      const sourceProjectPrefix = `projects/${sourceProjectId}/`
      if (JSON.stringify(keyframes).includes(sourceProjectPrefix)) {
        throw new Error(
          `Regenerate repoint incomplete for project ${projectId}: ${LONG_TAKE_KEYFRAMES_PATH} still references ${sourceProjectPrefix}`,
        )
      }

      logger.info(
        `[long-take] Regenerate artifacts copied ${formatLogFields({
          projectId,
          sourceProjectId,
          copiedFileCount: targetFiles.length,
          keyframeCount: keyframes.length,
          repointedFileCount,
          skippedFileCount,
          durationMs: Date.now() - startedAt,
        })}`,
      )

      return { keyframeCount: keyframes.length }
    }),
  )
}

/** How many missing names to name in the error before it stops being readable. */
const MAX_REPORTED_MISSING_FILES = 5

/**
 * List every object under the cloned trees, as `${dir}/${pathRelativeToDir}`.
 *
 * Deliberately un-caught: an unreadable listing must NOT degrade to an empty
 * array here. On the source that would fake a complete clone; on the target it
 * would fake a total one. Letting it throw hands the retry to the activity's
 * retry policy, the correct owner of a transient storage read.
 */
async function listClonedTreeFiles(storage: ProjectStore): Promise<string[]> {
  const listings = await Promise.all(
    COPIED_ARTIFACT_DIRS.map(async (dir) =>
      (await storage.listFiles(dir)).map((file) => `${dir}/${file}`),
    ),
  )
  return listings.flat()
}

/**
 * Fail the activity unless every object in the pre-copy source snapshot has a
 * namesake in the target, and return the target listing for the sweep to use.
 *
 * A NAME set, not a count: `copyFolderFromStorage` copies each file to the same
 * relative path, so a count match with a different membership is still a broken
 * clone (a retry that half-copied, a name that changed). The old check counted
 * one directory, which is why the sweep could only safely rewrite that one
 * directory's URIs.
 *
 * Snapshot-not-subset-of-target is the only failure. The target may hold MORE --
 * a partial earlier attempt the engine is retrying over, or an object written to
 * the still-live source after the snapshot and picked up by the copy's own
 * listing. Neither is a broken clone, and neither may cost the user a retry.
 */
async function assertClonedTreesComplete(
  storage: ProjectStore,
  params: { expectedFiles: string[]; projectId: string; sourceProjectId: string },
): Promise<string[]> {
  const { expectedFiles, projectId, sourceProjectId } = params
  const targetFiles = await listClonedTreeFiles(storage)
  const landed = new Set(targetFiles)
  const missing = expectedFiles.filter((filePath) => !landed.has(filePath))
  if (missing.length > 0) {
    const sample = missing.slice(0, MAX_REPORTED_MISSING_FILES).join(', ')
    const suffix = missing.length > MAX_REPORTED_MISSING_FILES ? ', ...' : ''
    throw new Error(
      `Regenerate artifact copy incomplete for project ${projectId}: ${missing.length}/${expectedFiles.length} files from ${sourceProjectId} did not land (${sample}${suffix})`,
    )
  }
  return targetFiles
}

/**
 * Load the in-memory inputs the regenerate workflow feeds into the
 * transitions stage, reading only from the new project's own prefix
 * (populated by copyLongTakeSourceArtifacts).
 */
export async function loadLongTakeRegenerateInputs(
  params: LoadLongTakeRegenerateInputsActivityParams,
): Promise<LoadLongTakeRegenerateInputsActivityResult> {
  const { projectId, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)

      const shotPlan = await storage.readJsonFile<LongTakeShotPlanItem[]>(LONG_TAKE_SHOT_PLAN_PATH)
      if (!Array.isArray(shotPlan) || shotPlan.length === 0) {
        throw new Error(`Project ${projectId} has an empty or invalid shot plan`)
      }
      const keyframes = await storage.readJsonFile<LongTakeKeyframeItem[]>(LONG_TAKE_KEYFRAMES_PATH)
      if (!Array.isArray(keyframes) || keyframes.length === 0) {
        throw new Error(`Project ${projectId} has no keyframes`)
      }

      // Transition timing extends the final clip to the voiceover duration, so
      // an incorrectly measured duration silently truncates the video; fail loudly.
      const audioDurationSeconds = await measureVoiceoverDurationSeconds(storage, projectId)

      const globalScript = await readOptionalGlobalScript(storage, projectId)
      const promptRoute = await readOptionalPromptRoute(storage)
      const pipelineContext = await readOptionalPipelineContext(storage)

      logger.info(
        `[long-take] Regenerate inputs loaded ${formatLogFields({
          projectId,
          audioDurationSeconds,
          hasGlobalScript: Boolean(globalScript),
          hasPipelineContext: Boolean(pipelineContext),
          keyframeCount: keyframes.length,
          promptRoute: promptRoute ?? 'none',
          shotCount: shotPlan.length,
        })}`,
      )

      return {
        audioDurationSeconds,
        globalScript,
        keyframes,
        pipelineContext,
        promptRoute,
        shotPlan,
      }
    }),
  )
}

/**
 * Rewrite a project-scoped URI (store:// or CDN form) from the source project's
 * prefix to the new project's, but only when it names an object under one of the
 * two trees this activity clones. Anything else was NOT copied -- there is no
 * object at the rewritten path -- so it must keep pointing at the source.
 *
 * This was widened from the keyframe images dir alone to both copied trees.
 * The narrow version left every other manifest URI (`keyframe_thumbnails.json`
 * thumbnails, the experts asset manifest, anchors, the visual script) pointing at
 * `projects/{sourceProjectId}/long_take/...` on a row read under the DERIVED project's
 * id, so the derived project kept depending on files in another project's folder.
 *
 * Matching on the tree prefix (not on a bare `projects/{sourceProjectId}/`) is what
 * keeps this honest: `projects/{sourceProjectId}/bgm/bed-{sha}.mp3` is NOT cloned here,
 * so it is deliberately left alone and carried by the API seed step instead.
 *
 * Each MATCH is decided on its own, not the whole string -- learned the hard way.
 * One value can carry two paths (a concatenated field, or a URL with another path
 * in its query), and a blanket `split(sourcePrefix).join(...)` would repoint the
 * second one too, somewhere nothing was copied.
 *
 * Rewriting is only sound because the caller has already asserted that every
 * object under both cloned trees actually landed (`assertClonedTreesComplete`).
 * Without that, a file `copyFolderFromStorage` silently dropped would have its
 * reference moved from a source path that exists to a target path that does not.
 *
 * The `(^|/)` anchor catches a bare object path (`projects/{id}/long_take/...`) as well
 * as a `store://` or CDN URL, and cannot match mid-segment (`foo-ao/{id}/...`).
 */
export function repointCopiedArtifactUri(
  uri: string,
  sourceProjectId: string,
  projectId: string,
): string {
  return COPIED_ARTIFACT_DIRS.reduce((rewritten, dir) => {
    const pattern = new RegExp(
      `(^|/)projects/${escapeRegExp(sourceProjectId)}/(${escapeRegExp(dir)}/[^"'\\s?#]*)`,
      'g',
    )
    return rewritten.replace(
      pattern,
      (_match, lead: string, relativePath: string) =>
        `${lead}projects/${projectId}/${relativePath}`,
    )
  }, uri)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/**
 * How many manifests to read/rewrite at once. `listFiles` is recursive, so a
 * large project yields a long list; both in-repo precedents for a fan-out over
 * project media cap it the same way (`MAX_CARRIED_BRAND_ASSETS`,
 * `copyStoredFolder`).
 */
const REPOINT_CONCURRENCY = 25

/**
 * Repoint every URI in every copied JSON manifest, in place.
 *
 * Deliberately a blind deep walk over each manifest rather than a hand-picked
 * list of fields. The URL-bearing shapes differ per manifest and gain new ones as
 * new stages ship, so enumerating them by name goes stale silently and leaves
 * a URL pointing at the source project. A string that is not a URI under
 * a copied tree is returned unchanged, so walking everything is safe.
 *
 * A per-file failure is NOT simply swallowed. Every manifest whose read, walk or
 * write threw is re-read as raw TEXT and checked for source-scoped residue:
 *
 *   residue present -> throw. The file still carries exactly the URLs this
 *   activity exists to remove, and reporting success would ship the defect while
 *   claiming it was fixed. The activity retries.
 *
 *   no residue (or the text read fails too) -> log and skip. There is nothing to
 *   repair, or nothing can be proven about it; burning a paid regenerate over an
 *   unreadable side manifest that may hold no URI at all is a poor trade. The
 *   count is surfaced so the log says how many were passed over.
 *
 * Idempotent, because the engine retries this activity: a second pass finds the
 * URIs already repointed and rewrites nothing.
 */
async function repointCopiedArtifactManifests(
  storage: ProjectStore,
  params: { manifestPaths: string[]; projectId: string; sourceProjectId: string },
): Promise<{ repointedFileCount: number; skippedFileCount: number }> {
  const { manifestPaths, projectId, sourceProjectId } = params

  let repointedFileCount = 0
  let skippedFileCount = 0
  for (let index = 0; index < manifestPaths.length; index += REPOINT_CONCURRENCY) {
    const batch = manifestPaths.slice(index, index + REPOINT_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (manifestPath) => {
        try {
          const payload = await storage.readJsonFile<unknown>(manifestPath)
          const repointed = repointUrisDeep(payload, {
            depth: 0,
            manifestPath,
            projectId,
            sourceProjectId,
          })
          if (!repointed.changed) {
            return 'unchanged'
          }
          await storage.writeJsonFile(manifestPath, repointed.value)
          return 'repointed'
        } catch (error) {
          await assertNoSourceResidue(storage, {
            error,
            manifestPath,
            projectId,
            sourceProjectId,
          })
          return 'skipped'
        }
      }),
    )
    repointedFileCount += results.filter((result) => result === 'repointed').length
    skippedFileCount += results.filter((result) => result === 'skipped').length
  }
  return { repointedFileCount, skippedFileCount }
}

/**
 * Decide whether a manifest this sweep could not process is safe to pass over.
 *
 * Reading it back as text is what separates "we failed on a file that holds no
 * source URI" from "we failed on the file that holds the bug". Only the second
 * is worth failing a paid regenerate for -- and it must fail, because
 * `keyframe_thumbnails.json` is preferred over the repointed `keyframes.json`
 * downstream, so a silently-skipped sibling reinstates the whole defect.
 *
 * A text read that also fails proves nothing, so it degrades to a skip: no worse
 * off than before this ran.
 */
async function assertNoSourceResidue(
  storage: ProjectStore,
  params: { error: unknown; manifestPath: string; projectId: string; sourceProjectId: string },
): Promise<void> {
  const { error, manifestPath, projectId, sourceProjectId } = params
  let raw: string | undefined
  try {
    raw = await storage.readTextFile(manifestPath)
  } catch {
    raw = undefined
  }
  const residue = COPIED_ARTIFACT_DIRS.find((dir) =>
    raw?.includes(`projects/${sourceProjectId}/${dir}/`),
  )
  if (residue) {
    throw new Error(
      `Regenerate repoint incomplete for project ${projectId}: ${manifestPath} still references projects/${sourceProjectId}/${residue}/ after ${formatError(error)}`,
    )
  }
  logger.warn(
    `[long-take] Regenerate repoint skipped ${formatLogFields({
      manifestPath,
      projectId,
      sourceProjectId,
      readable: raw !== undefined,
      err: formatError(error),
    })}`,
  )
}

/**
 * How deep to walk a manifest. These are our own artifacts, not user JSON, but
 * the cap is what keeps a pathological or cyclic file from hanging the activity.
 */
const MAX_REPOINT_DEPTH = 12

/**
 * Deep-rewrite every string in a parsed manifest, reporting whether anything
 * changed so an untouched file is not rewritten (a needless storage write, and a
 * needless object version).
 */
interface RepointContext {
  depth: number
  manifestPath: string
  projectId: string
  sourceProjectId: string
}

function repointUrisDeep(
  value: unknown,
  ctx: RepointContext,
): { changed: boolean; value: unknown } {
  const { depth, manifestPath, projectId, sourceProjectId } = ctx
  if (depth > MAX_REPOINT_DEPTH) {
    // Throwing, not truncating. Anything below the cap would keep its
    // source-scoped URIs, which is precisely the silent cross-project reference
    // this activity exists to remove -- and returning `changed: false` would also
    // discard whatever the shallower levels already rewrote. The caller's
    // text-level residue check then decides: a manifest this deep that holds no
    // source URI is skipped, one that does fails the activity.
    throw new Error(
      `Regenerate repoint depth cap reached for project ${projectId}: ${manifestPath} nests deeper than ${MAX_REPOINT_DEPTH}`,
    )
  }
  if (typeof value === 'string') {
    const next = repointCopiedArtifactUri(value, sourceProjectId, projectId)
    return { changed: next !== value, value: next }
  }
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const result = repointUrisDeep(item, { ...ctx, depth: depth + 1 })
      changed ||= result.changed
      return result.value
    })
    return changed ? { changed, value: next } : { changed, value }
  }
  if (isPlainObject(value)) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const result = repointUrisDeep(item, { ...ctx, depth: depth + 1 })
      changed ||= result.changed
      // defineProperty, not assignment: a manifest parsed from JSON can carry a
      // genuine own `__proto__` key, and plain assignment would hit the inherited
      // setter instead of creating the property, silently dropping it.
      Object.defineProperty(next, key, {
        configurable: true,
        enumerable: true,
        value: result.value,
        writable: true,
      })
    }
    return changed ? { changed, value: next } : { changed, value }
  }
  return { changed: false, value }
}

/** Only plain objects are rebuilt; a class instance is returned as-is. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const proto = Object.getPrototypeOf(value) as null | object
  return proto === Object.prototype || proto === null
}

async function measureVoiceoverDurationSeconds(
  storage: ProjectStore,
  projectId: string,
): Promise<number> {
  const voiceoverUri = storage.getFullPath(STORY_LOADER_PATHS.audioVoiceoverPath)
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lt-regenerate-'))
  const localPath = path.join(tempDir, 'voice_over.mp3')
  try {
    await downloadAssetToLocal(voiceoverUri, localPath)
    const durationSeconds = await getVideoDurationSeconds(localPath)
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`Could not measure voiceover duration for project ${projectId}`)
    }
    return durationSeconds
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

async function readOptionalGlobalScript(
  storage: ProjectStore,
  projectId: string,
): Promise<string | undefined> {
  try {
    const script = await storage.readTextFile(STORY_LOADER_PATHS.scriptTxtPath)
    return script?.trim() || undefined
  } catch (error) {
    logger.warn(
      `[long-take] Regenerate script read skipped ${formatLogFields({
        projectId,
        err: formatError(error),
      })}`,
    )
    return undefined
  }
}

async function readOptionalPipelineContext(
  storage: ProjectStore,
): Promise<PipelineContextEntry[] | undefined> {
  try {
    const payload = await storage.readJsonFile<PipelineContextEntry[]>(
      LONG_TAKE_PIPELINE_CONTEXT_PATH,
    )
    return Array.isArray(payload) && payload.length > 0 ? payload : undefined
  } catch {
    return undefined
  }
}

async function readOptionalPromptRoute(
  storage: ProjectStore,
): Promise<LongTakePromptRoute | undefined> {
  try {
    const payload = await storage.readJsonFile<{ prompt_route?: string }>(
      LONG_TAKE_PROMPT_ROUTE_CLASSIFICATION_PATH,
    )
    const route = payload?.prompt_route
    return route && (LONG_TAKE_PROMPT_ROUTES as readonly string[]).includes(route)
      ? (route as LongTakePromptRoute)
      : undefined
  } catch {
    return undefined
  }
}
