import fs from 'node:fs'

import { generateImage } from '@reelmakeeasy/common/llm'
import { Content } from '@reelmakeeasy/common/llm/clients/client'
import { imageModelForRole } from '@reelmakeeasy/common/llm/image-model-selection'
import { Logger } from '@reelmakeeasy/common/logger'
import { contentTypeFor } from '@reelmakeeasy/common/storage/file-store'
import { presetPath } from '@reelmakeeasy/common/storage/presets'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { BadRequestException, Injectable } from '@nestjs/common'

/** The image style previews are painted onto, in the repo's `presets/` folder. */
const BASE_IMAGE_PRESET = 'style-preview-base.png'

let baseImageDataUri: string | undefined

/** The preset base image as a data URI, read from disk once. */
function defaultBaseImage(): string {
  baseImageDataUri ??= `data:${contentTypeFor(BASE_IMAGE_PRESET)};base64,${fs
    .readFileSync(presetPath(BASE_IMAGE_PRESET))
    .toString('base64')}`
  return baseImageDataUri
}

const STYLE_PREVIEW_TASK = 'media-generate-style-preview'

@Injectable()
export class StylePreviewService {
  private readonly logger = new Logger(StylePreviewService.name)

  /**
   * Generates a styled preview image by applying the given style text to a base image
   * using the registry's image.edit model.
   */
  async generateStyledPreview(styleText: string, baseImageUrl?: string): Promise<string> {
    if (!styleText?.trim()) {
      throw new BadRequestException('Style text is required')
    }
    const requested = baseImageUrl?.trim()
    if (requested && !requested.startsWith('http://') && !requested.startsWith('https://')) {
      throw new BadRequestException('Base image URL must be http or https')
    }
    const url = requested || defaultBaseImage()

    const prompt = `Apply the following style to the provided image. Preserve the composition and subject of the image; change only the visual style. Output a single image that reflects this style.

Style: ${styleText.trim()}`

    const contents: Content[] = [
      { type: 'text', text: prompt },
      { type: 'image_url', imageUrl: url },
    ]

    try {
      const result = await generateImage({
        models: [imageModelForRole('image.edit')],
        contents,
        prompt,
        aspectRatio: '9:16',
        task: STYLE_PREVIEW_TASK,
        timeout: 80_000,
      })
      return result.imageBase64
    } catch (error) {
      const err = ensureError(error)
      this.logger.error(
        { error: err, styleTextLength: styleText.length },
        'Failed to generate style preview',
      )
      throw new BadRequestException(`Failed to generate style preview: ${err.message}`)
    }
  }
}
