// The two storage steps that make a copied long-take project actually
// restyle. Both exist because style is carried by ARTIFACTS the regenerate copy
// clones verbatim, not by workflow params -- so passing a new styleText and
// doing nothing else re-renders the ORIGINAL style with no error at all.
//
//   1. prepareLongTakeRestyleTarget -- style_source.json is what
//      generateLongTakeKeyframePrompts reads (that activity takes no styleText
//      argument); the copied file holds the SOURCE style and would win.
//   2. applyLongTakeRestyleKeyframePrompts -- keyframe generation reads its
//      prompt from shot_plan.json (keyframe-retry-fallback.ts passes
//      shot.keyframe_prompt), NOT from keyframe_prompts.json. The reused shot
//      plan carries the source's style-baked prompts, so the freshly generated
//      prompts have to be pushed onto it or they are never used.
//
// Both fail loudly rather than degrade: a silent no-op here bills a full
// generation and delivers the old style back to the user.

import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'

import type {
  ApplyLongTakeRestyleKeyframePromptsActivityParams,
  ApplyLongTakeRestyleKeyframePromptsActivityResult,
  LongTakeShotPlanItem,
  PrepareLongTakeRestyleTargetActivityParams,
  PrepareLongTakeRestyleTargetActivityResult,
} from '../../workflows/long-take/types'

import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { LONG_TAKE_SHOT_PLAN_PATH } from './regenerate'
import {
  createLongTakeStorage,
  LONG_TAKE_KEYFRAME_PROMPTS_PATH,
  LongTakeKeyframePromptsOutputSchema,
} from './storage'
import { LONG_TAKE_STYLE_SOURCE_PATH } from './visual-script'

const LONG_TAKE_VISUAL_SCRIPT_PATH = 'long_take/visual_script.json'

// normalizeShotPlanDurations splits an overlong shot into `<baseId>_part_<n>`
// children (the first chunk keeps the base id). Those children are time slices
// of the SAME visual-script shot, so they are not present in keyframe_prompts
// and resolve their prompt through the base id.
const SHOT_ID_SPLIT_SUFFIX = /_part_\d+$/

/**
 * Re-point the reused shot plan at the freshly generated keyframe prompts.
 * Mirrors the override pass buildLongTakeShotPlan runs (same shot_id keying,
 * same prompt_base source) for the restyle path, which deliberately reuses the
 * source's shot plan instead of rebuilding it.
 *
 * Every shot must resolve a new prompt. A shot left on its old prompt renders in
 * the SOURCE style inside an otherwise restyled video, which no downstream stage
 * can detect, so an unresolved shot fails the run.
 */
export async function applyLongTakeRestyleKeyframePrompts(
  params: ApplyLongTakeRestyleKeyframePromptsActivityParams,
): Promise<ApplyLongTakeRestyleKeyframePromptsActivityResult> {
  const { projectId, sourceProjectId, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)

      const shotPlan = await storage.readJsonFile<LongTakeShotPlanItem[]>(LONG_TAKE_SHOT_PLAN_PATH)
      if (!Array.isArray(shotPlan) || shotPlan.length === 0) {
        throw ApplicationFailure.nonRetryable(
          `Restyle found no reusable shot plan for project ${projectId}`,
          'invariant_violation',
        )
      }

      // Read (and parse) directly rather than through
      // readLongTakeKeyframePromptOverrides: that helper turns a transient storage
      // read failure into an empty map, which here would look like a hard
      // mismatch and burn the run instead of letting the activity retry.
      const restyledBases = await readKeyframePromptBases(storage)
      // The source's pre-restyle bases, used only to keep whatever a later step
      // appended to a shot prompt (the music route's per-split-chunk direction).
      const sourceBases = await readSourceKeyframePromptBases(sourceProjectId)

      const unresolvedShotIds: string[] = []
      let matchedShotCount = 0
      let updatedShotCount = 0
      for (const shot of shotPlan) {
        const baseShotId = resolveBaseShotId(shot.shot_id)
        const restyledBase = baseShotId ? restyledBases.get(baseShotId) : undefined
        if (!restyledBase) {
          unresolvedShotIds.push(shot.shot_id?.trim() || '<missing shot_id>')
          continue
        }
        matchedShotCount += 1
        const restyledPrompt = `${restyledBase}${resolveAppendedPromptTail(
          shot.keyframe_prompt,
          baseShotId ? sourceBases.get(baseShotId) : undefined,
        )}`
        if (restyledPrompt === shot.keyframe_prompt) {
          continue
        }
        shot.keyframe_prompt = restyledPrompt
        updatedShotCount += 1
      }

      if (unresolvedShotIds.length > 0) {
        throw ApplicationFailure.nonRetryable(
          `Restyle found no regenerated keyframe prompt for ${unresolvedShotIds.length}/${shotPlan.length} reused shots in project ${projectId}: ${unresolvedShotIds.join(', ')}`,
          'invariant_violation',
        )
      }

      await storage.writeJsonFile(LONG_TAKE_SHOT_PLAN_PATH, shotPlan)
      logger.info(
        `[long-take] Restyle keyframe prompts applied to shot plan ${formatLogFields({
          projectId,
          matchedShotCount,
          shotCount: shotPlan.length,
          sourceProjectId,
          updatedShotCount,
        })}`,
      )

      return { matchedShotCount, shotPlan, updatedShotCount }
    }),
  )
}

/**
 * Point the freshly copied target at the new style, and make sure the one
 * artifact the restyle re-derives from actually landed.
 *
 * The style_source.json write is the load-bearing step:
 * generateLongTakeKeyframePrompts reads the style from that file, so leaving the
 * source's copy in place re-bakes the ORIGINAL style into every keyframe prompt.
 *
 * The visual-script check exists because `copyFolderFromStorage` logs and
 * swallows individual file-copy failures, and `generateLongTakeKeyframePrompts`
 * treats a missing visual script as "no shots" and writes an empty prompts
 * artifact. A single dropped file would therefore surface two stages later as
 * "no regenerated prompt for any shot" and burn a paid run, so it is repaired
 * here (single-file re-copy) while the failure is still cheap and retryable.
 */
export async function prepareLongTakeRestyleTarget(
  params: PrepareLongTakeRestyleTargetActivityParams,
): Promise<PrepareLongTakeRestyleTargetActivityResult> {
  const { projectId, sourceProjectId, styleText, userId } = params
  const resolvedStyleText = styleText?.trim()
  // No target style = nothing to restyle into, and the copied file would win
  // silently. A caller bug, so refuse rather than bill a duplicate render.
  if (!resolvedStyleText) {
    throw ApplicationFailure.nonRetryable(
      `Restyle requires a target style text for project ${projectId}`,
      'invariant_violation',
    )
  }
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir('long_take')
      await storage.writeJsonFile(LONG_TAKE_STYLE_SOURCE_PATH, { style_text: resolvedStyleText })

      const visualScriptRecovered = await ensureCopiedVisualScript({
        projectId,
        sourceProjectId,
        storage,
      })

      logger.info(
        `[long-take] Restyle target prepared ${formatLogFields({
          projectId,
          sourceProjectId,
          styleTextLength: resolvedStyleText.length,
          visualScriptRecovered,
        })}`,
      )
      return { styleSourcePath: LONG_TAKE_STYLE_SOURCE_PATH, visualScriptRecovered }
    }),
  )
}

/**
 * Re-copy long_take/visual_script.json when the bulk folder copy dropped it.
 * Throws a plain (retryable) error if it is still unusable afterwards, so
 * activity retries ride out a transient storage blip instead of the run dying
 * later on an empty prompts artifact.
 */
async function ensureCopiedVisualScript(params: {
  projectId: string
  sourceProjectId: string
  storage: ReturnType<typeof createLongTakeStorage>
}): Promise<boolean> {
  const { projectId, sourceProjectId, storage } = params
  if (await hasVisualScriptShots(storage)) {
    return false
  }
  logger.warn(
    `[long-take] Restyle target visual script missing after copy, re-copying ${formatLogFields({
      projectId,
      sourceProjectId,
    })}`,
  )
  await storage.copyFileFromStorage(
    createLongTakeStorage(sourceProjectId),
    LONG_TAKE_VISUAL_SCRIPT_PATH,
  )
  if (!(await hasVisualScriptShots(storage))) {
    throw new Error(
      `Restyle could not recover ${LONG_TAKE_VISUAL_SCRIPT_PATH} for project ${projectId} from ${sourceProjectId}`,
    )
  }
  return true
}

async function hasVisualScriptShots(
  storage: ReturnType<typeof createLongTakeStorage>,
): Promise<boolean> {
  try {
    const visualScript = await storage.readJsonFile<unknown[]>(LONG_TAKE_VISUAL_SCRIPT_PATH)
    return Array.isArray(visualScript) && visualScript.length > 0
  } catch {
    return false
  }
}

async function readKeyframePromptBases(
  storage: ReturnType<typeof createLongTakeStorage>,
): Promise<Map<string, string>> {
  const payload = await storage.readJsonFile<unknown>(LONG_TAKE_KEYFRAME_PROMPTS_PATH)
  const parsed = LongTakeKeyframePromptsOutputSchema.parse(payload)
  return new Map(
    parsed.shots
      .map((shot) => [shot.shot_id?.trim(), shot.prompt_base?.trim()] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
  )
}

/**
 * Best-effort: the tail preservation below is a refinement, so a source project
 * with no readable keyframe_prompts.json falls back to a plain prompt swap
 * instead of failing the restyle.
 */
async function readSourceKeyframePromptBases(
  sourceProjectId: string,
): Promise<Map<string, string>> {
  try {
    return await readKeyframePromptBases(createLongTakeStorage(sourceProjectId))
  } catch (error) {
    logger.warn(
      `[long-take] Restyle source keyframe prompt read skipped ${formatLogFields({
        sourceProjectId,
        err: formatError(error),
      })}`,
    )
    return new Map()
  }
}

/**
 * Text a later shot-plan step appended to the shot's prompt on top of the
 * keyframe-prompt base -- today only the music route's per-split-chunk direction
 * (diversifyMusicSplitChunks). Carried onto the restyled base so a music restyle
 * keeps its per-chunk variation instead of collapsing every split chunk onto one
 * identical prompt.
 */
function resolveAppendedPromptTail(
  shotPrompt: string | undefined,
  sourceBase: string | undefined,
): string {
  const prompt = shotPrompt ?? ''
  if (!sourceBase || !prompt.startsWith(sourceBase)) {
    return ''
  }
  return prompt.slice(sourceBase.length)
}

function resolveBaseShotId(shotId: string | undefined): string | undefined {
  const trimmed = shotId?.trim()
  return trimmed ? trimmed.replace(SHOT_ID_SPLIT_SUFFIX, '') : undefined
}
