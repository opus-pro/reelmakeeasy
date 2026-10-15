import { JobContext } from '@reelmakeeasy/common/job-context'
import type { Content } from '@reelmakeeasy/common/llm'
import { z } from 'zod'

import type {
  GenerateV3ClipPromptsActivityParams,
  GenerateV3ClipPromptsActivityResult,
} from '../../workflows/long-take/types'
import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from '../long-take/common'
import { createLongTakeStorage } from '../long-take/storage'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import {
  buildLongTakeV3ClipPrompt,
  type V3ClipPromptShotInput,
} from '../prompts/long-take-v3-clip-prompt'

export const V3_CLIP_PROMPTS_PATH = 'long_take_v3/clip_prompts.json'

const V3_CLIP_PROMPT_MODELS = ['gemini-3.8-flash', 'gemini-2.5-pro', 'gpt-5'] as const

/**
 * `transition_prompt` is `.nullable()`, never a bare `.optional()`. Every model
 * tier in this chain falls back to a gpt-* model, and OpenAI strict mode rejects
 * an optional-without-nullable field inside `zodResponseFormat` -- it throws
 * client-side, so the failure only appears once the Gemini primary degrades.
 */
export const V3ClipPromptsOutputSchema = z.object({
  shots: z.array(
    z.object({
      motion_prompt: z.string(),
      shot_id: z.string(),
      transition_prompt: z.string().nullable(),
    }),
  ),
})

/**
 * Turn each shot into the prompt the video model receives, using the keyframes
 * that were actually rendered.
 *
 * This runs after keyframe generation on purpose. The visual script's
 * `core_description` is a design brief; the model needs to see the frame it is
 * animating away from -- and, for a `continuous` hand-off, the frame it has to
 * land on -- before it can describe a camera path between them.
 *
 * Fail-soft: on any model failure every shot falls back to its own
 * `core_description`, which is exactly what V2 would have sent. A degraded
 * prompt is better than a failed render.
 */
export async function generateV3ClipPrompts(
  params: GenerateV3ClipPromptsActivityParams,
): Promise<GenerateV3ClipPromptsActivityResult> {
  const { keyframeUriByShotId, pipelineContext, projectId, shotPlan, styleText, userId } = params
  return withLongTakeContext({ pipelineContext, projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)

      const fallback = (): GenerateV3ClipPromptsActivityResult => ({
        clipPrompts: shotPlan.map((shot) => ({
          motionPrompt: shot.video_prompt || shot.keyframe_prompt,
          shotId: shot.shot_id,
          transitionPrompt: null,
        })),
        usedFallback: true,
      })

      if (shotPlan.length === 0) {
        return { clipPrompts: [], usedFallback: false }
      }

      // Only frame-backed shots reach the model. The prompt tells it every shot
      // comes with a rendered opening frame, so listing one without an image
      // would have it author motion for a composition it never saw; those shots
      // take the per-shot fallback below instead.
      const framedShots = shotPlan.filter((shot) => keyframeUriByShotId[shot.shot_id])
      const shots: V3ClipPromptShotInput[] = framedShots.map((shot, index) => ({
        audio: shot.audio,
        coreDescription: shot.video_prompt || shot.keyframe_prompt,
        durationSeconds: Math.max(0, shot.time_range.end - shot.time_range.start),
        shotId: shot.shot_id,
        // A hand-off the model cannot see the destination of is not a hand-off it
        // can design, and the clip plan drops that shot's last frame too -- so it
        // is presented (and generated) as a cut.
        transitionToNext:
          shot.transition_to_next === 'continuous' &&
          !hasLandingFrame(framedShots, index, keyframeUriByShotId)
            ? 'cut'
            : (shot.transition_to_next ?? null),
      }))

      const contents = buildV3ClipPromptContents(shotPlan, keyframeUriByShotId)
      if (contents.length === 0) {
        // No keyframe resolved for any shot -- the whole point of this stage is
        // to look at them, so a text-only call would just be a worse V2.
        logger.warn(
          `[long-take-v3] Clip prompts skipped, no keyframes resolved ${formatLogFields({
            projectId,
            shotCount: shotPlan.length,
          })}`,
        )
        return fallback()
      }

      try {
        const modelOutput = await JobContext.run({ projectId, userId }, async () =>
          runLongTakeCompletionWithRecord({
            projectId,
            userId,
            options: {
              contents,
              models: [...V3_CLIP_PROMPT_MODELS],
              prompt: buildLongTakeV3ClipPrompt({ shots, styleText }),
              responseFormat: V3ClipPromptsOutputSchema,
              task: 'long-take-v3-clip-prompts',
              temperature: 0.2,
            },
          }),
        )

        const byShotId = new Map(
          modelOutput.shots
            .filter((item) => item.shot_id?.trim() && item.motion_prompt?.trim())
            .map((item) => [item.shot_id.trim(), item] as const),
        )
        const clipPrompts = shotPlan.map((shot) => {
          const match = byShotId.get(shot.shot_id)
          // Per-shot fallback, not all-or-nothing: one dropped shot should not
          // cost the other N-1 their authored prompts.
          if (!match) {
            return {
              motionPrompt: shot.video_prompt || shot.keyframe_prompt,
              shotId: shot.shot_id,
              transitionPrompt: null,
            }
          }
          const framedIndex = framedShots.findIndex((item) => item.shot_id === shot.shot_id)
          return {
            motionPrompt: match.motion_prompt.trim(),
            shotId: shot.shot_id,
            // A transition prompt on a `cut` shot describes an edit inside the
            // clip, which is precisely the artifact this contract removes. Same
            // for a `continuous` whose destination never rendered: the clip plan
            // generates it i2v-only, so there is nothing for it to land on.
            transitionPrompt:
              shot.transition_to_next === 'continuous' &&
              hasLandingFrame(framedShots, framedIndex, keyframeUriByShotId)
                ? match.transition_prompt?.trim() || null
                : null,
          }
        })

        await storage.ensureDir('long_take_v3')
        await storage.writeJsonFile(V3_CLIP_PROMPTS_PATH, { shots: clipPrompts })
        logger.info(
          `[long-take-v3] Clip prompts generated ${formatLogFields({
            projectId,
            shotCount: clipPrompts.length,
            continuousCount: clipPrompts.filter((item) => item.transitionPrompt).length,
            durationMs: Date.now() - startedAt,
          })}`,
        )
        return { clipPrompts, usedFallback: false }
      } catch (error) {
        logger.warn(
          `[long-take-v3] Clip prompts failed, falling back to descriptions ${formatLogFields({
            projectId,
            shotCount: shotPlan.length,
            err: formatError(error),
          })}`,
        )
        return fallback()
      }
    }),
  )
}

/**
 * Interleave a label with each frame so the model can tell them apart. Shot
 * order in the text matches image order here; without the labels a `continuous`
 * shot's two frames are indistinguishable from two consecutive shots' frames.
 */
export function buildV3ClipPromptContents(
  shotPlan: GenerateV3ClipPromptsActivityParams['shotPlan'],
  keyframeUriByShotId: Record<string, string>,
): Content[] {
  const contents: Content[] = []
  // Walk the frame-backed shots so a `continuous` hand-off looks at the shot that
  // actually follows it in the payload, not at one that was filtered out.
  const framed = shotPlan.filter((shot) => keyframeUriByShotId[shot.shot_id])
  framed.forEach((shot, index) => {
    const uri = keyframeUriByShotId[shot.shot_id]
    contents.push(
      { text: `Opening frame of ${shot.shot_id}:`, type: 'text' },
      { imageUrl: uri, type: 'image_url' },
    )

    if (shot.transition_to_next !== 'continuous') {
      return
    }
    const nextUri = keyframeUriByShotId[framed[index + 1]?.shot_id ?? '']
    if (nextUri) {
      contents.push(
        {
          text: `Frame that ${shot.shot_id} must land on (opening frame of the next shot):`,
          type: 'text',
        },
        { imageUrl: nextUri, type: 'image_url' },
      )
    }
  })
  return contents
}

/**
 * Whether the shot after `index` has a rendered frame for this one to land on.
 * Walks the frame-backed list, so a filtered-out shot in between does not make a
 * hand-off look reachable.
 */
function hasLandingFrame(
  framedShots: GenerateV3ClipPromptsActivityParams['shotPlan'],
  index: number,
  keyframeUriByShotId: Record<string, string>,
): boolean {
  const next = framedShots[index + 1]
  return Boolean(next && keyframeUriByShotId[next.shot_id])
}
