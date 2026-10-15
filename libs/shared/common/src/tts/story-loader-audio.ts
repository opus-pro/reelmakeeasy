import { STORY_LOADER_PATHS } from '../agent-v2/paths'
import { createStorage } from '../agent-v2/storage/storage'

/**
 * Relative storage key for the story-loader voiceover, shared by every writer and
 * reader (minimax TTS, cross-provider tool, video-crew/editor/render). Keeping a
 * single constant guarantees the storage write and the cross-pod storage read align.
 */
export const STORY_LOADER_VOICE_OVER_KEY = STORY_LOADER_PATHS.audioVoiceoverPath

/**
 * Whether the story-loader voiceover should be written to / read from storage. True
 * when a projectId is available.
 */
export function shouldUseStoredStoryLoaderAudio(projectId?: string): projectId is string {
  return Boolean(projectId)
}

/**
 * Write the voiceover mp3 to storage at the shared relative key.
 */
export async function writeStoryLoaderVoiceOverToStore(
  projectId: string,
  audio: Buffer,
): Promise<string> {
  const storage = await createStorage(projectId)
  return storage.writeFile(STORY_LOADER_VOICE_OVER_KEY, audio)
}
