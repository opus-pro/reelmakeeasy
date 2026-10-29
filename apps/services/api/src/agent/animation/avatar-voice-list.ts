import { PRESET_VOICES, type PresetVoice } from '@reelmakeeasy/common/tts/preset-voices'

/**
 * The voices Claude picks from for a new avatar's fixed voice: the free English presets that
 * run on this computer (Kokoro and Qwen3 speakers), each the same voice every time.
 */

/** The free English presets an avatar can be given: Kokoro and Qwen3 speakers. */
export const AVATAR_PRESET_VOICES: readonly PresetVoice[] = PRESET_VOICES.filter(
  (v) =>
    v.visible !== false &&
    (v.provider === 'kokoro' || v.provider === 'qwen3') &&
    v.labels.some((l) => l.startsWith('English')),
)

/** The voices Claude picks from, one per entry: `id (accent, gender, tone): what it suits`. */
export function avatarVoiceList(): string {
  return AVATAR_PRESET_VOICES.map(
    (v) =>
      `${v.id} (${v.labels[0]?.replace('English ', '') ?? ''}, ${(v.labels[1] ?? '').toLowerCase()}, ${v.tone.toLowerCase()}): ${v.description}`,
  ).join('; ')
}

/** A preset's name (`Kokoro Michael`), else the id. */
export const voiceName = (voiceId: string): string =>
  PRESET_VOICES.find((v) => v.id === voiceId)?.name ?? voiceId
