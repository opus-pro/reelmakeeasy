import { falOutputUrl } from './generic'
import type { MusicAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

/**
 * MiniMax Music 2.0 is a song model: it requires lyrics. Song-structure tags marked
 * instrumental, with no words to sing, give a full arrangement without vocals; the
 * description carries the style (the BGM director's prompt ends with "Instrumental.").
 */
export const MINIMAX_INSTRUMENTAL_LYRICS =
  '[Intro]\n[Instrumental]\n[Verse]\n[Instrumental]\n[Chorus]\n[Instrumental]\n[Outro]'

const PROMPT_MIN = 10
const PROMPT_MAX = 2000

/**
 * MiniMax Music 2.0 on fal (`fal-ai/minimax-music/v2`, about $0.03 a piece). There is no
 * length setting: a piece runs a minute or so and the bed is trimmed (or looped) to the
 * video afterwards.
 */
export const minimaxMusic: MusicAdapter = {
  buildRequest(model, _mode, o) {
    const prompt = o.prompt.trim().slice(0, PROMPT_MAX).padEnd(PROMPT_MIN, '.')
    return {
      endpoint: endpointFor(model, 'generate'),
      input: withEntryInput(model, {
        audio_setting: { bitrate: 256_000, format: 'mp3', sample_rate: 44_100 },
        lyrics_prompt: MINIMAX_INSTRUMENTAL_LYRICS,
        prompt,
      }),
    }
  },
  parseOutput: falOutputUrl,
}
