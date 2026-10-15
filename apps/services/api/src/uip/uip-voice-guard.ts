import { pickedVoiceUnavailableReason } from '@reelmakeeasy/common/tts/voice-engines'
import { BadRequestException } from '@nestjs/common'

/**
 * Refuse a voice the Easy (UIP) flow can't speak with, in the voice list's words, before
 * anything is saved or the video is queued: today a Gemini voice without GEMINI_API_KEY
 * ("Needs a Gemini key: add it in Setup"). Other voices and no voice pass.
 */
export function assertUipVoiceUsable(voiceId: null | string | undefined): void {
  const unavailable = pickedVoiceUnavailableReason(voiceId ?? undefined)
  if (unavailable) throw new BadRequestException(unavailable)
}
