import { JobContext } from '@reelmakeeasy/common/job-context'
import { completion } from '@reelmakeeasy/common/llm/completion'
import { logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { audioLlmRoute } from '@reelmakeeasy/llm'
import type { VoiceProfile, VoiceProfileSourceKind } from '@shared/types/api/voice-profile'
import {
  buildVoiceProfileFromAnalysis,
  VoiceProfileAnalysisSchema,
} from '@shared/types/api/voice-profile'

export async function analyzeVoiceProfileFromAudioUri(params: {
  audioUri: string
  sourceKind: Extract<VoiceProfileSourceKind, 'uploaded_audio' | 'voice_clone'>
}): Promise<null | VoiceProfile> {
  const { audioUri, sourceKind } = params
  // Codex and Claude Code can't hear audio: with either chosen in Setup, pin the call to Gemini
  // when its key is set, else save the clone without the description written from its audio.
  const route = audioLlmRoute()
  if (route === 'skip') {
    logger.info({ sourceKind }, "[VoiceProfile] Skipped: the AI chosen in Setup can't hear audio")
    return null
  }
  const analyze = () =>
    completion({
      contents: [{ type: 'audio_url', audioUrl: audioUri }],
      models: ['gemini-3.8-flash', 'gemini-2.5-pro'],
      prompt: buildVoiceProfileAnalysisPrompt(),
      responseFormat: VoiceProfileAnalysisSchema,
      responseValidator: (result) => result.tags.length <= 6,
      task: 'voice-profile-analysis',
      temperature: 0,
      timeout: 15000,
    })

  try {
    const analysis = await (route === 'gemini'
      ? JobContext.run({ llmProvider: 'gemini' }, analyze)
      : analyze())
    return buildVoiceProfileFromAnalysis({ analysis, sourceKind })
  } catch (error) {
    logger.warn(
      { audioUri, err: ensureError(error), sourceKind },
      '[VoiceProfile] Failed to analyze voice profile from audio',
    )
    return null
  }
}

function buildVoiceProfileAnalysisPrompt(): string {
  return `Analyze the speaker's voice in this audio and return structured voice metadata.

Focus only on traits that are clearly perceivable from the voice itself.

Return:
- perceivedGender: female, male, or unknown
- ageRange: child, teen, 20s, 30s, 40s, 50_plus, or unknown
- tags: 1 to 6 short lower-case qualities such as warm, calm, bright, husky, authoritative, playful, cinematic
- rawDescription: one concise phrase summarizing the voice

Rules:
- Use unknown instead of guessing for gender or age.
- Base perceivedGender on vocal presentation only, not identity.
- Keep tags short and non-redundant.
- Omit anything not strongly supported by the audio.`
}
