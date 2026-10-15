import {
  CaptionStyleSettingsError,
  normalizeCaptionStyleSettings,
} from '@reelmakeeasy/common/adapters/caption/caption-style'
import { BadRequestException } from '@nestjs/common'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'

/**
 * Validate the caption-settings body: the fields sent (see
 * normalizeCaptionStyleSettings), at least one of them. Throws BadRequestException
 * so the controller answers 400 with the reason in plain words.
 */
export function parseCaptionSettingsBody(body: unknown): CaptionStyleSettings {
  let settings: CaptionStyleSettings
  try {
    settings = normalizeCaptionStyleSettings(body)
  } catch (error) {
    if (error instanceof CaptionStyleSettingsError) {
      throw new BadRequestException(error.message)
    }
    throw error
  }
  if (Object.keys(settings).length === 0) {
    throw new BadRequestException('Send at least one of preset, accent, position, size or font')
  }
  return settings
}
