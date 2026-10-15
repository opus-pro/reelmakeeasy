import fs from 'node:fs'

import { presetPackUrl, presetPath } from '@reelmakeeasy/common/storage/presets'
import { Controller, Get } from '@nestjs/common'

const STYLES_FILE = 'story-mode/styles.json'

interface StylePreset {
  id: string
  label: string
  previewVideoUrl?: string
  shortDescription?: string
  styleText?: string
  thumbnailUrl: string
  useCase?: string
}

interface StylesFile {
  songStyles: StylePreset[]
  styles: StylePreset[]
}

const withUrls = (style: StylePreset): StylePreset => ({
  ...style,
  thumbnailUrl: presetPackUrl(style.thumbnailUrl),
  ...(style.previewVideoUrl ? { previewVideoUrl: presetPackUrl(style.previewVideoUrl) } : {}),
})

/**
 * The Story Mode preset style catalog from `presets/story-mode/styles.json`,
 * with asset paths (relative to the preset pack) turned into URLs.
 */
@Controller('story-mode')
export class StoryModeStylesController {
  @Get('styles')
  styles(): StylesFile {
    const file = JSON.parse(fs.readFileSync(presetPath(STYLES_FILE), 'utf8')) as StylesFile
    return { songStyles: file.songStyles.map(withUrls), styles: file.styles.map(withUrls) }
  }
}
