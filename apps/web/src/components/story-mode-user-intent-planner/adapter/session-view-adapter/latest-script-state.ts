import type { RenderStateLatestScript } from '../../state-types'
import type { SessionState } from '../api-types'

import { resolveSessionAudioUrl } from './audio-url'

/**
 * The script + uploaded voice-over the render state exposes as "latest".
 *
 * Split out of `timeline.ts` when that file reached its 800-line cap.
 */
export function buildLatestScriptState(params: {
  cdnOrigin: string
  sessionId: string
  state: SessionState
}): RenderStateLatestScript | undefined {
  const audioUrl = resolveSessionAudioUrl(params.state, params.sessionId, params.cdnOrigin)

  return {
    audioUrl,
    audioSource: params.state.audio_source ?? null,
    text: params.state.script?.content?.trim() ?? '',
  }
}
