/**
 * Voice character text rendering for anchor prompt injection.
 *
 * UIP anchor generation uses a "voice character" string to soft-bias
 * narrator visual characteristics (gender / age / qualities). The string
 * comes from one of two sources depending on session mode:
 *
 *   audio mode:
 *     pre-voiceover workflow's Stage 3 runs `analyzeLongTakeVoiceCharacter`
 *     against the uploaded audio and writes a rich LLM-generated string
 *     to `long_take/voice_character.json`. anchor activity reads that
 *     file and uses the LLM string verbatim.
 *
 *   non-audio mode (preset / temp clone / saved clone):
 *     no audio to analyze. The structured `VoiceProfile` (already on
 *     `SessionState.voiceProfile`, populated from
 *     `project.voiceOverJson.voiceProfile` at session creation) is
 *     rendered into a comparable string here.
 *
 * Both paths converge to a single string `voiceCharacterText` consumed
 * by anchor-asset-manager and anchor-prompt-spec prompt builders.
 *
 * Returns `undefined` if neither source yields usable content -- callers
 * skip injection in that case (preserving current behavior).
 */

import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import type { VoiceProfile } from '@shared/types/api/voice-profile'

/**
 * Path mirrors story-mode's `LONG_TAKE_VOICE_CHARACTER_PATH`. UIP
 * pre-voiceover Stage 3 writes here via `analyzeLongTakeVoiceCharacter`.
 * Lives at the project root (NOT under `user-intent-planner/`) so the
 * existing storymode / scanner consumers find it at the same path.
 */
const VOICE_CHARACTER_RELATIVE_PATH = 'long_take/voice_character.json'

interface VoiceCharacterArtifact {
  voice_character: string
  voice_profile?: VoiceProfile
}

/**
 * Read the voice character artifact written by the pre-voiceover
 * workflow's Stage 3. Returns `null` when the file is missing (audio
 * mode skipped, analysis failed, or non-audio session) -- callers fall
 * back to `SessionState.voiceProfile`.
 */
export type VoiceCharacterTextInput =
  | {
      /** LLM-generated rich description from voice_character.json. */
      audioVoiceCharacter: string
      source: 'audio'
      /** Structured profile (also written into voice_character.json by storymode). */
      voiceProfile?: VoiceProfile
    }
  | {
      source: 'profile'
      voiceProfile: VoiceProfile
    }

export function buildVoiceCharacterText(input: VoiceCharacterTextInput): string | undefined {
  if (input.source === 'audio') {
    const trimmed = input.audioVoiceCharacter.trim()
    if (trimmed) {
      return trimmed
    }
    // Fall through to profile rendering if audio string is empty (defensive).
    return input.voiceProfile ? renderFromProfile(input.voiceProfile) : undefined
  }
  return renderFromProfile(input.voiceProfile)
}

export async function loadVoiceCharacterArtifact(
  projectId: string,
): Promise<null | VoiceCharacterArtifact> {
  if (process.env['NODE_ENV'] === 'test') {
    return null
  }

  // Project-root scope (NOT user-intent-planner sub-prefix), matching
  // the path storymode + scanner already use.
  const storage = new ProjectStore(projectId)
  const exists = await storage.exists(VOICE_CHARACTER_RELATIVE_PATH)
  if (!exists) {
    return null
  }
  return storage.readJsonFile<VoiceCharacterArtifact>(VOICE_CHARACTER_RELATIVE_PATH)
}

function renderFromProfile(profile: VoiceProfile): string | undefined {
  // Prefer a pre-rendered description when present -- preset metadata
  // helpers and audio-derived analysis both populate this.
  const raw = profile.rawDescription?.trim()
  if (raw) {
    return raw
  }

  // Fallback: synthesize from structured fields, dropping `'unknown'`
  // sentinels so we don't leak schema-internal placeholders into the
  // LLM prompt.
  const parts = [profile.perceivedGender, profile.ageRange, ...profile.tags].filter(
    (part): part is string => Boolean(part) && part !== 'unknown',
  )

  const synthesized = parts.join(', ').trim()
  return synthesized ? synthesized : undefined
}
