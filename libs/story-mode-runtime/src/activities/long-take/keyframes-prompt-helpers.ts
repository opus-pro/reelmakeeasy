import type { Content } from '@reelmakeeasy/common/llm'
import { buildStyleReferenceContents } from '@reelmakeeasy/common/long-take/style-reference'
import type { LongTakeHumanPresence } from '@reelmakeeasy/common/long-take/types'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'

import {
  buildLongTakeAnchorContents,
  getLongTakeKeyframeAnchorParams,
  type LongTakeAnchorMeta,
} from './anchor-meta'
import { buildLongTakeKeyframePrompt, type LongTakeKeyframeGlobalContext } from './storage'

/**
 * Per-shot prompt assembly for long-take keyframe generation.
 *
 * Centralizes the per-shot anchor inspection + keyframe prompt build for the
 * `generateLongTakeKeyframe` activity so the per-shot plumbing lives in one
 * place. `promptRoute` threads through to the routed-prompt builder.
 * `improvedVisualScriptEnabled` is still accepted for caller compatibility,
 * but USER_FILE Prop keyframe prompts intentionally match the legacy/gate-off
 * anchor behavior. `styleReferenceUris` (the project's style reference image, from a
 * saved image style) go after the anchors, with an instruction saying they set the look
 * and are not content.
 */
export function buildLongTakeKeyframeShotInputs(opts: {
  anchorLookup: Map<string, LongTakeAnchorMeta>
  basePrompt: string
  globalContext: LongTakeKeyframeGlobalContext | null
  humanPresence?: LongTakeHumanPresence
  improvedVisualScriptEnabled: boolean
  keyframePromptReworkEnabled?: boolean
  promptRoute?: LongTakePromptRoute
  styleName?: string
  styleReferenceUris?: string[]
  styleText?: string
  usedAssetIds?: string[]
}): {
  promptPayload: ReturnType<typeof buildLongTakeKeyframePrompt>
  shotContents: Content[]
} {
  const anchorContents = opts.usedAssetIds?.length
    ? buildLongTakeAnchorContents(opts.usedAssetIds, opts.anchorLookup)
    : []
  const promptPayload = buildLongTakeKeyframePrompt({
    basePrompt: opts.basePrompt,
    globalContext: opts.globalContext,
    humanPresence: opts.humanPresence,
    keyframePromptReworkEnabled: opts.keyframePromptReworkEnabled,
    promptRoute: opts.promptRoute,
    styleName: opts.styleName,
    styleText: opts.styleText,
    ...getLongTakeKeyframeAnchorParams(
      opts.usedAssetIds,
      opts.anchorLookup,
      anchorContents.length > 0,
    ),
  })
  const shotContents = [
    ...anchorContents,
    ...buildStyleReferenceContents(opts.styleReferenceUris ?? []),
  ]
  return { promptPayload, shotContents }
}
