import { storedFileUrl } from '@reelmakeeasy/common/storage/stored-files'

/**
 * The Story Mode voice-over track for a project, as a stored-file URL.
 *
 * Unconditional, so the project read costs no storage round-trip: a project with
 * no voice-over yields a URL that 404s. Story Mode roots every project at
 * `projects/{projectId}` (see `ProjectStore.getProjectRoot`).
 */
export function deriveVoiceoverAudioUrl(projectId: string): null | string {
  if (!projectId) {
    return null
  }
  return storedFileUrl(`projects/${projectId}/story_loader/audio/voice_over.mp3`)
}
