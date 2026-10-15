import { isRetiredVoiceId } from '@reelmakeeasy/common/tts/legacy-voices'
import { isPresetVoiceId } from '@reelmakeeasy/common/tts/preset-voices'
import { getUserVoiceCloneDataService } from '@shared/db-access-layer'

import { formatError, formatLogFields, logger } from './common'

export async function isLongTakeUserVoiceCloneVoiceId(
  voiceId: string | undefined,
): Promise<boolean> {
  const normalizedVoiceId = voiceId?.trim()
  if (!normalizedVoiceId) {
    return false
  }
  // Presets and retired presets are never clones; skip the lookup.
  if (isPresetVoiceId(normalizedVoiceId) || isRetiredVoiceId(normalizedVoiceId)) {
    return false
  }
  try {
    const provider = await getUserVoiceCloneDataService().getProviderByVoiceId(normalizedVoiceId)
    return Boolean(provider)
  } catch (error) {
    logger.warn(
      `[long-take] Failed to check user voice clone ${formatLogFields({
        voiceId: normalizedVoiceId,
        err: formatError(error),
      })}`,
    )
    return true
  }
}
