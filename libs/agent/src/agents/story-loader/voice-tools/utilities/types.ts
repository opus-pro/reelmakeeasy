import type { TtsProvider } from '../utils/provider-tts.util'

export type TtsAndAsrResult = {
  message: string
  status: 'error' | 'failure' | 'success' | 'success_with_quality_issues'
  transcript?: string
  transcript_path?: string
  ttsProvider?: TtsProvider
  voice_over_path?: string
  voiceSubstituted?: boolean
}
