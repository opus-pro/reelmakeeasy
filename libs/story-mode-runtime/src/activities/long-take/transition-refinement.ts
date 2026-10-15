import { JobContext } from '@reelmakeeasy/common/job-context'
import { z } from 'zod'

import { buildLongTakeRoutedPromptTemplate } from '../../long-take-prompt-router'
import { buildTransitionPrompt } from '../../workflows/long-take/transition-planning'
import type {
  LongTakeTransitionPromptRefinementInput,
  RefineLongTakeTransitionPromptsActivityParams,
  RefineLongTakeTransitionPromptsActivityResult,
} from '../../workflows/long-take/types'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'

import {
  formatError,
  formatLogFields,
  logger,
  mapWithConcurrency,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import {
  detectSameSubject,
  estimateSemanticJump,
  formatThreePartPrompt,
  hasHeadlineText,
} from './transitions-text-helpers'

const LongTakeRefinedTransitionPromptSchema = z.object({
  anchor_subject: z
    .string()
    .describe('The main visual anchor that should carry continuity, or "environment" if none'),
  movement_axis: z
    .enum(['vertical', 'horizontal', 'mixed'])
    .describe('The dominant transition axis suggested by the two frames'),
  strategy: z
    .enum(['subject_lock', 'motivated_reframe', 'pan_occlusion_bridge'])
    .describe('The most natural transition strategy for these two frames'),
  strategy_reason: z
    .string()
    .describe('One short sentence explaining why this strategy is the most natural'),
  scene_a_action: z.string().describe('Motion/action prompt for Scene A (outgoing scene)'),
  transition_movement: z.string().describe('Camera transition movement bridging the two scenes'),
  scene_b_action: z.string().describe('Motion/action prompt for Scene B (incoming scene)'),
})

export async function refineSingleTransitionPrompt(params: {
  globalScript?: string
  projectId: string
  promptRoute?: RefineLongTakeTransitionPromptsActivityParams['promptRoute']
  transition: LongTakeTransitionPromptRefinementInput
  userId: string
}): Promise<{ prompt: string; transitionId: string }> {
  const { globalScript, projectId, promptRoute, transition, userId } = params
  const promptText = buildTransitionRefinementPrompt({ globalScript, promptRoute, transition })

  const result = await JobContext.run({ projectId, userId: userId || 'long-take' }, async () =>
    runLongTakeCompletionWithRecord({
      anchorId: transition.transitionId,
      anchorType: 'transition',
      projectId,
      userId: userId || 'long-take',
      options: {
        contents: [
          { type: 'image_url' as const, imageUrl: transition.firstFrameUri },
          { type: 'image_url' as const, imageUrl: transition.lastFrameUri },
        ],
        models: 'flash',
        prompt: promptText,
        responseFormat: LongTakeRefinedTransitionPromptSchema,
        task: 'long-take-transition-prompt-refinement-v6',
        temperature: 0.2,
      },
    }),
  )

  const combinedPrompt = formatThreePartPrompt(
    result.scene_a_action,
    result.transition_movement,
    result.scene_b_action,
  )

  return {
    prompt: combinedPrompt,
    transitionId: transition.transitionId,
  }
}

function buildTransitionRefinementPrompt(params: {
  globalScript?: string
  promptRoute?: RefineLongTakeTransitionPromptsActivityParams['promptRoute']
  transition: LongTakeTransitionPromptRefinementInput
}): string {
  const { globalScript, promptRoute, transition } = params
  const { durationSeconds, fromKeyframePrompt, fromPrompt, toKeyframePrompt, toPrompt, styleText } =
    transition
  const sameSubject = detectSameSubject(transition)
  const semanticJump = estimateSemanticJump(transition)

  const lines = [
    'You are choosing the most natural transition strategy for an image-to-video model.',
    '',
    'Look at the two frames first, before relying on the text descriptions. Decide what the visual anchor is and which transition approach will feel the most natural while minimizing hallucinated scenery and impossible morphing.',
    '',
    'You are given two images:',
    '- FIRST image = ending frame of Scene A',
    '- SECOND image = opening frame of Scene B',
    '',
    `Scene A keyframe: ${fromKeyframePrompt}`,
    `Scene A motion: ${fromPrompt}`,
    `Scene B keyframe: ${toKeyframePrompt}`,
    `Scene B motion: ${toPrompt}`,
    `Duration: ${durationSeconds} seconds`,
    `Same-subject continuity is ${sameSubject ? 'likely' : 'unlikely'}.`,
    `Scene-jump risk is ${semanticJump > 0.55 ? 'high' : semanticJump > 0.35 ? 'medium' : 'low'}.`,
  ]

  if (globalScript?.trim()) {
    lines.push(`Global story context: ${globalScript.trim()}`)
  }

  if (styleText) {
    lines.push(`Style to maintain: ${styleText}`)
  }

  if (hasHeadlineText(fromKeyframePrompt) || hasHeadlineText(toKeyframePrompt)) {
    lines.push(
      'If text is prominent, avoid treating the text itself as the main animated transformation.',
    )
  }

  lines.push(
    '',
    'Choose one strategy:',
    '- "subject_lock": use when the same subject should remain the visual through-line',
    '- "motivated_reframe": use when the scenes are related but the camera should naturally reframe from one composition to the next',
    '- "pan_occlusion_bridge": use when the frames differ enough that a short fast vertical or horizontal pan, helped by blur, wipe, foreground pass, or hidden-cut style occlusion, is more believable than transforming one scene directly into the other',
    '',
    'Decision priorities:',
    '- First identify the strongest visual anchor from the two frames.',
    '- Prefer the anchor over secondary scenery when a clear shared subject exists.',
    '- If the same subject appears in both frames, try subject_lock first and keep that subject as the through-line unless the composition shift clearly demands a broader reframe.',
    '- If you choose motivated_reframe, write transition_movement as a short, decisive bridge with one clear camera action that pivots from Scene A into Scene B.',
    '- For motivated_reframe, prefer a brisk push, pull, tilt, arc, snap-tilt, or rotation over a soft summary like "smoothly reframes" or "naturally transitions."',
    '- If the visual gap is large or a direct transformation would likely cause awkward morphing, prefer pan_occlusion_bridge and choose either a vertical or horizontal pan based on the two frame compositions.',
    '- If you choose pan_occlusion_bridge, write the transition_movement itself as that short, fast pan with a brief blur, wipe, foreground pass, structural edge, or occlusion cue that hides the hardest part of the change.',
    '- Prefer a believable bridge over an ambitious one.',
    '- Keep the output concise, simple, and motion-first.',
    '- The final prompt should still read as three parts: Scene A active motion, a short fast bridge, then Scene B active motion.',
    '- Keep the bridge brief relative to the full clip.',
    '- Give the bridge some rhythm and impact: it should feel punchy and cinematic rather than flat, gentle, or dragged out.',
    '- "scene_a_action" must describe only the opening scene and its active motion.',
    '- "transition_movement" must describe only the bridge itself.',
    '- "scene_b_action" must describe only the landing scene and its active motion.',
    '',
    'Return JSON with exactly these fields:',
    '- "anchor_subject": the best continuity anchor',
    '- "movement_axis": "vertical", "horizontal", or "mixed"',
    '- "strategy": one of "subject_lock", "motivated_reframe", or "pan_occlusion_bridge"',
    '- "strategy_reason": one short sentence explaining the choice',
    '- "scene_a_action"',
    '- "transition_movement"',
    '- "scene_b_action"',
  )

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt: lines.join('\n'),
    promptRoute,
    templateName: 'transition-refinement',
  })
}

const REFINEMENT_CONCURRENCY = 5

export async function refineLongTakeTransitionPrompts(
  params: RefineLongTakeTransitionPromptsActivityParams,
): Promise<RefineLongTakeTransitionPromptsActivityResult> {
  const { globalScript, projectId, promptRoute, transitions, userEmail, userId } = params
  return withLongTakeContext({ projectId, userEmail, userId: userId || 'long-take' }, () =>
    withActivityHeartbeat(async () => {
      if (transitions.length === 0) {
        return { refinedPrompts: [] }
      }

      logger.info(
        `[long-take] Transition prompt refinement started ${formatLogFields({
          projectId,
          transitionCount: transitions.length,
        })}`,
      )

      const refinedPrompts = await mapWithConcurrency(
        transitions,
        REFINEMENT_CONCURRENCY,
        async (transition) => {
          try {
            return await refineSingleTransitionPrompt({
              globalScript,
              projectId,
              promptRoute,
              transition,
              userId,
            })
          } catch (error) {
            logger.warn(
              `[long-take] Transition prompt refinement failed for ${transition.transitionId}, using fallback ${formatLogFields(
                {
                  projectId,
                  transitionId: transition.transitionId,
                  err: formatError(error),
                },
              )}`,
            )
            return {
              prompt: buildTransitionPrompt(
                transition.fromPrompt,
                transition.toPrompt,
                transition.styleText,
                promptRoute,
              ),
              transitionId: transition.transitionId,
            }
          }
        },
      )

      logger.info(
        `[long-take] Transition prompt refinement completed ${formatLogFields({
          projectId,
          refinedCount: refinedPrompts.length,
        })}`,
      )

      return { refinedPrompts }
    }),
  )
}
