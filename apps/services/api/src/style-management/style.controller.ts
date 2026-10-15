import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { generateUploadSignedUrl } from '@reelmakeeasy/common/storage/stored-files'
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common'

import { StyleService } from './style.service'

@Controller('styles')
export class StyleController {
  private readonly logger = new Logger(StyleController.name)

  constructor(private readonly styleService: StyleService) {}

  @Post('generate-upload-url')
  async generateUploadUrl(
    @Body()
    body: {
      files: Array<{
        contentType: string
        fileName: string
        fileType: 'background' | 'font' | 'reference'
      }>
      styleId?: string
    },
  ) {
    try {
      this.logger.log(`Generating upload URLs for ${body.files?.length || 0} files`)

      // Validate inputs
      if (!Array.isArray(body.files) || body.files.length === 0) {
        throw new HttpException('Files array is required', HttpStatus.BAD_REQUEST)
      }

      if (body.files.length > 20) {
        throw new HttpException('Maximum 20 files allowed', HttpStatus.BAD_REQUEST)
      }

      // Use provided styleId or generate a temporary one
      const styleId = body.styleId || `temp-${Date.now()}`
      const timestamp = Date.now()

      // Generate signed URLs for all files
      const uploads = await Promise.all(
        body.files.map(async (file, index) => {
          if (!file.fileName?.trim()) {
            throw new HttpException(
              `File name is required for file at index ${index}`,
              HttpStatus.BAD_REQUEST,
            )
          }

          if (!file.contentType?.trim()) {
            throw new HttpException(
              `Content type is required for file at index ${index}`,
              HttpStatus.BAD_REQUEST,
            )
          }

          if (!['background', 'font', 'reference'].includes(file.fileType)) {
            throw new HttpException(
              `Invalid file type "${file.fileType}" for file at index ${index}. Must be reference, background, or font`,
              HttpStatus.BAD_REQUEST,
            )
          }

          // Validate content type based on file type
          if (file.fileType === 'reference' || file.fileType === 'background') {
            if (!file.contentType.startsWith('image/')) {
              throw new HttpException(
                `File type "${file.fileType}" must be an image`,
                HttpStatus.BAD_REQUEST,
              )
            }
          } else if (file.fileType === 'font') {
            const validFontTypes = ['font/', 'application/font', 'application/x-font']
            const isValidFont = validFontTypes.some((type) => file.contentType.includes(type))
            if (!isValidFont) {
              throw new HttpException(
                'File type "font" must be a font file',
                HttpStatus.BAD_REQUEST,
              )
            }
          }

          // Generate store path: styles/{styleId}/{fileType}/{timestamp}-{filename}
          const sanitizedFileName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
          const fileUri = `styles/${styleId}/${file.fileType}/${timestamp}-${sanitizedFileName}`

          // Generate signed URL for upload (15 minutes expiry)
          const { signedUrl, expiresAt } = await generateUploadSignedUrl(
            fileUri,
            file.contentType,
            15 * 60 * 1000,
          )

          return {
            signedUrl,
            fileUri,
            fileType: file.fileType,
            expiresAt,
            index,
          }
        }),
      )

      this.logger.log(`Upload URLs generated successfully for ${uploads.length} files`)

      return {
        uploads,
        styleId,
      }
    } catch (e) {
      const error = ensureError(e)
      this.logger.error({ error, styleId: body.styleId }, 'Error generating upload URLs')

      if (error instanceof HttpException) {
        throw error
      }

      throw new HttpException(
        {
          status: 'error',
          message: error.message || 'Failed to generate upload URLs',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  @Get()
  async getAllStyles() {
    try {
      this.logger.log('Received request to fetch all styles')

      const result = await this.styleService.getStylesList()

      this.logger.log('Styles fetched successfully')

      return {
        status: 'success',
        data: result,
        timestamp: new Date().toISOString(),
      }
    } catch (e) {
      const error = ensureError(e)
      this.logger.error({ error }, 'Error fetching styles')

      if (error instanceof HttpException) {
        throw error
      }

      throw new HttpException(
        {
          status: 'error',
          message: error.message || 'Internal server error',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  @Get('live')
  async getLiveStyles() {
    try {
      this.logger.log('Received request to fetch Live styles')

      const result = await this.styleService.getAllLiveStyles()

      this.logger.log('Live styles fetched successfully')

      return {
        status: 'success',
        data: result,
        timestamp: new Date().toISOString(),
      }
    } catch (e) {
      const error = ensureError(e)
      this.logger.error({ error }, 'Error fetching Live styles')

      if (error instanceof HttpException) {
        throw error
      }

      throw new HttpException(
        {
          status: 'error',
          message: error.message || 'Internal server error',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  @Get(':name')
  async getStyleByName(@Param('name') name: string) {
    try {
      this.logger.log(`Received request to fetch style by name: ${name}`)

      const result = await this.styleService.getStyleByName(name)

      this.logger.log('Style fetched successfully')

      return {
        status: 'success',
        data: result,
        timestamp: new Date().toISOString(),
      }
    } catch (e) {
      const error = ensureError(e)
      this.logger.error({ error, name }, 'Error fetching style by name')

      if (error instanceof HttpException) {
        throw error
      }

      throw new HttpException(
        {
          status: 'error',
          message: error.message || 'Internal server error',
          timestamp: new Date().toISOString(),
        },
        error.message.includes('not found')
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }
}
