import { completion } from '@reelmakeeasy/common/llm/completion'
import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { getPublicCdnUrl } from '@reelmakeeasy/common/storage/stored-files'
import { Injectable } from '@nestjs/common'
import { z } from 'zod'

export interface StyleConfig {
  fonts: Array<{ family: string; uri: string; weight: string }>
  palette: {
    primary: string
    secondary: string
  }
  styleInstructions: string
  styleName: string
}

@Injectable()
export class StyleConfigService {
  private readonly logger = new Logger(StyleConfigService.name)

  isValidStyleConfig(obj: unknown): obj is StyleConfig {
    if (typeof obj !== 'object' || obj === null) {
      return false
    }
    const config = obj as Record<string, unknown>

    return (
      typeof config.styleName === 'string' &&
      typeof config.styleInstructions === 'string' &&
      Array.isArray(config.fonts) &&
      config.fonts.every((font: unknown) => {
        if (typeof font !== 'object' || font === null) {
          return false
        }
        const f = font as Record<string, unknown>
        return (
          typeof f.family === 'string' && typeof f.uri === 'string' && typeof f.weight === 'string'
        )
      }) &&
      typeof config.palette === 'object' &&
      config.palette !== null &&
      typeof (config.palette as Record<string, unknown>).primary === 'string' &&
      typeof (config.palette as Record<string, unknown>).secondary === 'string'
    )
  }

  async validateAndConvertStyleConfig(styleText: string): Promise<StyleConfig> {
    // Try to parse as JSON first
    try {
      const parsed: unknown = JSON.parse(styleText)

      // Check if it matches the StyleConfig format
      if (this.isValidStyleConfig(parsed)) {
        return parsed
      }

      // If not valid, use LLM to convert
      this.logger.log('Invalid style config format, using LLM to convert')
      return await this.convertToStyleConfigWithLLM(styleText)
    } catch (_error) {
      // Not valid JSON, use LLM to convert
      this.logger.log('Invalid JSON, using LLM to convert')
      return await this.convertToStyleConfigWithLLM(styleText)
    }
  }

  private async convertToStyleConfigWithLLM(styleText: string): Promise<StyleConfig> {
    const styleConfigSchema = z.object({
      styleName: z.string().describe('The name of the style'),
      styleInstructions: z.string().describe('Detailed style instructions'),
      fonts: z.array(
        z.object({
          family: z.string().describe('Font family name'),
          uri: z.string().describe('Font file URI (use common Google Fonts URLs)'),
          weight: z.string().describe('Font weight (e.g., regular, bold)'),
        }),
      ),
      palette: z.object({
        primary: z.string().describe('Primary color hex code'),
        secondary: z.string().describe('Secondary color hex code'),
      }),
    })

    const prompt = `Convert the following style description into a structured StyleConfig JSON format.

User Input:
${styleText}

Requirements:
1. Extract or infer a style name
2. Create detailed style instructions
3. Suggest appropriate fonts (use Google Fonts URLs from our CDN, e.g., /public/ae-template/google-fonts/base-fonts/Inter.ttf)
4. Define a color palette with primary and secondary colors (use hex codes)

Generate a complete StyleConfig JSON object.`

    try {
      const result = await completion({
        task: 'convert-style-text-to-config',
        models: ['gemini-3.5-flash', 'gpt-5'],
        prompt,
        responseFormat: styleConfigSchema,
        temperature: 0.7,
      })

      return result as StyleConfig
    } catch (_error) {
      this.logger.error(`LLM conversion failed: ${ensureError(_error).message}`)

      // Return a default config if LLM fails
      return {
        styleName: 'Custom Style',
        styleInstructions: styleText,
        fonts: [
          {
            family: 'Inter',
            uri: getPublicCdnUrl('ae-template/google-fonts/base-fonts/Inter.ttf'),
            weight: 'regular',
          },
        ],
        palette: {
          primary: '#000000',
          secondary: '#666666',
        },
      }
    }
  }
}
