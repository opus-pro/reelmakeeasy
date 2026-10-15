/**
 * The engine's audio comes up separately from its first frame: it loads its AudioWorklet
 * code and creates the node that feeds the speakers, and logs this line when the node is
 * up. A play started before that has no sound until the engine restarts its audio player,
 * so callers that start playback themselves (autoplay) wait for it.
 */
const AUDIO_READY_LINE = /\b322322 AudioWorkletProcessorCreated\b/

export function isAudioReadyLine(text: unknown): boolean {
  return typeof text === 'string' && AUDIO_READY_LINE.test(text)
}

/** How long autoplay waits for the audio after the first frame before playing anyway. */
export const AUDIO_READY_MAX_WAIT_MS = 1500

/** Autoplay once the first frame is drawn and the audio is up (or the wait ran out). */
export function shouldAutoPlay(input: {
  audioReady: boolean
  autoPlay: boolean
  readyForPlay: boolean
  waitedMs: number
}): boolean {
  if (!input.autoPlay || !input.readyForPlay) return false
  return input.audioReady || input.waitedMs >= AUDIO_READY_MAX_WAIT_MS
}
