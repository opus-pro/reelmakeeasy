import { hasElevenLabsKey } from '@reelmakeeasy/common/elevenlabs/key'
import { isDev } from '@reelmakeeasy/common/utils/env'
import { currentGenerationProvider, type GenerationProvider } from '@reelmakeeasy/llm/registry'
import type { StandardCloneBackend } from '@shared/types/api/voice-over'

/**
 * Where the Standard voice clone runs.
 * - On Gemini (google): ElevenLabs instant cloning with ELEVENLABS_API_KEY, else none. MiniMax
 *   runs on fal, which Gemini doesn't use.
 * - On fal: ElevenLabs with its key (development still clones on MiniMax when fal is set, to
 *   keep the ElevenLabs account's voice slots free); MiniMax on fal (FAL_KEY) otherwise.
 * - null when neither works: the clone is refused ("Needs an ElevenLabs key").
 */
export function standardCloneBackend(
  env: NodeJS.ProcessEnv = process.env,
  dev = isDev(),
  generation: GenerationProvider = currentGenerationProvider(),
): null | StandardCloneBackend {
  if (generation === 'google') return hasElevenLabsKey(env) ? 'elevenlabs' : null
  const fal = Boolean(env['FAL_KEY']?.trim())
  if (hasElevenLabsKey(env) && !(dev && fal)) return 'elevenlabs'
  return fal ? 'minimax' : null
}
