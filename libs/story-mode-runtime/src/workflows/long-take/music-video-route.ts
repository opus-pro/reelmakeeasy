import type { LongTakePromptRoute } from '../../long-take-prompt-router'

// Music-video route helper shared by the UIP workflows. The dedicated music-video
// route (a beat sheet built from the song's beat grid feeding a music-aware
// visual-script prompt) is off, so every workflow keeps its text-driven route.

// Why the music route was not taken. Tracked on project.long_take.completed for
// the music dashboard's routing-quality panel.
export type MusicRouteFallbackReason = 'gate_off' | 'not_music'

// Resolve the full music-video outcome for a workflow in one call: no music beat
// sheet is built, so the prompt route is always the given text route.
export async function resolveMusicVideoRoute(params: {
  isMusic: boolean | undefined
  textPromptRoute: LongTakePromptRoute
}): Promise<{
  musicBeatCount: null | number
  /** 'analysis' | 'duration_fallback' when the music route is taken; null otherwise. */
  musicBeatSheetSource: 'analysis' | 'duration_fallback' | null
  /** Why the music route was not taken. Tracking-only. */
  musicFallbackReason: MusicRouteFallbackReason | null
  promptRoute: LongTakePromptRoute
}> {
  return {
    musicBeatCount: null,
    musicBeatSheetSource: null,
    musicFallbackReason: params.isMusic ? 'gate_off' : 'not_music',
    promptRoute: params.textPromptRoute,
  }
}
