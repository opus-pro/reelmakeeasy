/**
 * Which model makes a loop's clips: `beatLoopModelOrder` (the provider chosen in Setup first,
 * fal: MiniMax Hailuo 3, Google: Gemini Omni Flash; the other provider's model a fallback only
 * when its key is set; never Veo), and how a clip call runs on its model's provider.
 */
import {
  type BeatLoopModel,
  beatLoopModelOrder,
} from '@reelmakeeasy/common/long-take/beat-loop-craft'
import {
  pinnedGenerationProvider,
  runWithGenerationPin,
} from '@reelmakeeasy/common/workflow/generation-pin'
import { type GenerationProvider, setGenerationProviderPin } from '@reelmakeeasy/llm/registry'

export type BeatLoopClipModel = BeatLoopModel

/**
 * The loop clip models to try, in order (`beatLoopModelOrder`): every take starts with Setup's
 * provider's, so a fallback never sticks to the clips after it.
 */
export function beatLoopClipModels(
  options: Parameters<typeof beatLoopModelOrder>[0] = {},
): BeatLoopClipModel[] {
  return beatLoopModelOrder(options)
}

/** What a run says when the models file names no model that can make loop clips. */
export function noBeatLoopModelMessage(): string {
  return 'No model can make loop clips: the models file has no `beatLoop.video` list with a model of a provider whose key is set (MiniMax Hailuo 3 on fal, Gemini Omni Flash on Google)'
}

/**
 * Runs `fn` as if `provider` had been chosen in Setup. The model registry resolves every
 * model through the run's provider, so a Google fallback in a fal run must be pinned to
 * Google, or Omni would be swapped for fal's clip model. The pin is the one the workflow
 * engine registers at start-up; it is registered here too, for callers outside the engine.
 */
export function withBeatLoopProvider<T>(provider: GenerationProvider, fn: () => T): T {
  setGenerationProviderPin(pinnedGenerationProvider)
  return runWithGenerationPin(provider, fn)
}
