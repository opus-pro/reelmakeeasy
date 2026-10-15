import { posix } from 'node:path'

import type { ProjectVoiceOverJson } from '@shared/types/api/project'
import { storeKeyOf } from '@reelmakeeasy/common/storage/stored-files'

/**
 * Build a `voice-over-attachment` voiceOverJson for a UIP audio-mode project.
 *
 * UIP never runs the classic story-loader scanner (`generateVoiceOverJsonFromStoryLoader`),
 * so without this an audio / video-as-audio upload keeps the creation-time default
 * preset ("Rachel"). That leaks to creator-facing UI: the transcript editor keys
 * "is upload" off `voiceOverJson.type === 'voice-over-attachment'`, so a stale
 * `'voice-over'` makes it show a preset voice for the user's own audio.
 *
 * Minimal-correct: voice analysis (`long_take/voice_character.json`) does not exist
 * yet at confirm (the workflow produces it later), so `voiceProfile` is intentionally
 * omitted rather than fabricated, which also drops the misleading preset profile.
 */
export function buildUipAudioAttachmentVoiceOverJson(params: {
  audioUri?: null | string
  projectId: string
}): ProjectVoiceOverJson {
  const stem = params.audioUri
    ? posix
        .basename(params.audioUri)
        .replace(/\.[^.]+$/, '')
        .trim()
    : ''
  const name = stem || 'Uploaded audio'
  // Branch the suffix: truncating the literal fallback ('uploaded-audio'.slice(0,10)
  // -> 'uploaded-a') would be ugly, so only the filename-derived stem is sliced.
  const voiceId = stem
    ? `${params.projectId}-${stem.slice(0, 10)}`
    : `${params.projectId}-uploaded-audio`

  // Only a stored file is playable: its address is served as a URL when it reaches the UI.
  const previewAudioUrl =
    params.audioUri && storeKeyOf(params.audioUri) ? params.audioUri : undefined

  return {
    type: 'voice-over-attachment',
    voiceId,
    name,
    labels: ['Attachment', name],
    ...(previewAudioUrl ? { previewAudioUrl } : {}),
  }
}

/**
 * Partial `project.update` data that reconciles `voiceOverJson` for an audio-mode
 * UIP project, or `{}` for non-audio projects. Spread into the confirm/fast-confirm
 * `prisma.project.update(...)` data so the orchestration adds no extra branch.
 */
export function buildAudioModeProjectUpdate(params: {
  projectId: string
  sessionState: { audio_path?: null | string }
  spec: { meta?: null | { audio_source?: 'user_audio' | null } }
}): Record<string, never> | { voiceOverJson: ProjectVoiceOverJson } {
  if (params.spec.meta?.audio_source !== 'user_audio') {
    return {}
  }
  return {
    voiceOverJson: buildUipAudioAttachmentVoiceOverJson({
      audioUri: params.sessionState.audio_path ?? undefined,
      projectId: params.projectId,
    }),
  }
}
