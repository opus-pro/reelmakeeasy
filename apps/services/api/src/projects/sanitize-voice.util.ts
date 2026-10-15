import { ProjectVoiceOverJson } from '@shared/types/api/project'

/**
 * Strip creator-identifying metadata from a cloned-voice voiceOverJson before
 * exposing it on a non-owner-facing surface (public share links, demo cards).
 *
 * Cloned voices carry the human-readable clone name, internal voiceCloneId,
 * provider, previewAudioUrl (a voice biometric), and labels -- none of which
 * a remix viewer needs. The Remix resolver only matches `voiceId` against the
 * viewer's own clone list (see resolveRemixVoiceSelection); if the viewer
 * doesn't own it the request falls back to the default voice and the backend
 * voice guard (resolveLongTakeRequestVoice) rejects cross-org voiceId reuse
 * anyway.
 *
 * Preset (`voice-over`) and attachment (`voice-over-attachment`) types are
 * safe as-is -- presets are public, attachments are the creator's own asset
 * already served at an unauthenticated CDN URL.
 */
export function sanitizeCloneVoiceMetadata<T extends null | ProjectVoiceOverJson | undefined>(
  voiceOverJson: T,
): T {
  if (!voiceOverJson || voiceOverJson.type !== 'voice-cloned') {
    return voiceOverJson
  }
  return {
    name: '',
    type: 'voice-cloned',
    voiceId: voiceOverJson.voiceId,
  } as T
}
