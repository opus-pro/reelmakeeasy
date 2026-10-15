import { readFile, unlink } from 'node:fs/promises'
import path, { join } from 'node:path'

import { SUB_FOLDER, SUMMARY_NAME } from '@agent-lib/agents/common/constant'
import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { projectPathResolver } from '@reelmakeeasy/common/agent-v2/util/project-path-resolver'
import {
  INPAINT_REFERENCE_SCOPE,
  sanitizeReferenceOwnerId,
} from '@reelmakeeasy/common/inpaint/reference-path'
import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  downloadStoredFileWithRetry,
  generateUploadSignedUrl,
  storeUri,
} from '@reelmakeeasy/common/storage/stored-files'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import { Response } from 'express'

import { PrismaService } from '../prisma/prisma.service'
import { PROJECT_ACCESS, type ProjectAccess } from '../projects/project-access.token'

import { MediaService } from './media.service'
import { StyleConfigService } from './style-config.service'
import { StylePreviewService } from './style-preview.service'
import { StyleTextService } from './style-text.service'
import { resolveUploadedFileUri } from './uploaded-file-uri'

@Controller('media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name)

  constructor(
    private readonly mediaService: MediaService,
    private readonly styleConfigService: StyleConfigService,
    private readonly styleTextService: StyleTextService,
    private readonly stylePreviewService: StylePreviewService,
    private readonly prisma: PrismaService,
    // Injected by token, never by importing ProjectService as a value: that value
    // import closes a circular file import and crashes the API at boot. See
    // project-access.token.ts.
    @Inject(PROJECT_ACCESS)
    private readonly projectAccess: ProjectAccess,
  ) {}

  @Post('generate-style-instruction/:projectId')
  async generateStyleInstruction(
    @Param('projectId') projectId: string,
    @Body() body: { styleText: string },
  ) {
    if (!body.styleText) {
      throw new BadRequestException('No style text provided')
    }

    try {
      // Validate and convert style text to proper StyleConfig format
      const styleConfig = await this.styleConfigService.validateAndConvertStyleConfig(
        body.styleText,
      )

      // Write via the storage abstraction (storage).
      const styleConfigPath = `${SUB_FOLDER.STORYBOARD}/${SUMMARY_NAME.STYLE_CONFIG_FILE}`
      const storage = await createStorage(projectId)
      await storage.writeJsonFile(styleConfigPath, styleConfig)

      return {
        fileName: SUMMARY_NAME.STYLE_CONFIG_FILE,
        path: styleConfigPath,
        styleConfig,
        message: 'Style config generated and saved successfully.',
        success: true,
      }
    } catch (e) {
      const error = ensureError(e)
      throw new BadRequestException(`Error generating style config: ${error.message}`)
    }
  }

  @Post('generate-style-name')
  async generateStyleName(@Body() body: { styleText?: string }) {
    if (!body.styleText?.trim()) {
      throw new BadRequestException('Style text is required')
    }
    const { styleName } = await this.styleTextService.generateNameFromText(body.styleText)
    return { styleName }
  }

  @Post('generate-style-preview')
  async generateStylePreview(@Body() body: { baseImageUrl?: string; styleText?: string }) {
    if (!body.styleText?.trim()) {
      throw new BadRequestException('Style text is required')
    }
    const previewImageBase64 = await this.stylePreviewService.generateStyledPreview(
      body.styleText,
      body.baseImageUrl,
    )
    return { previewImageBase64 }
  }

  @Post('generate-style-text')
  async generateStyleText(@Body() body: { imageDataUrl?: string }) {
    if (!body.imageDataUrl) {
      throw new BadRequestException('Image data is required')
    }

    const { styleText, styleName } = await this.styleTextService.generateFromImageDataUrl(
      body.imageDataUrl,
    )
    return { styleText, styleName }
  }

  @Post('generate-temp-upload-url')
  async generateTempUploadUrl(
    @Body()
    body: {
      contentType: string
      fileName: string
      scope?: string
    },
  ) {
    if (!body.fileName || !body.contentType) {
      throw new BadRequestException('Missing file name or content type')
    }

    const timestamp = Date.now()
    const rawScope = body.scope || 'story-mode-audio'
    // Canonicalize BEFORE the scope is allowed to drive authorization. The
    // path.posix.join below normalizes "./x", "x/" and "x//" to the same object
    // path, so comparing the raw form would let an alias skip the identity gate
    // while still landing inside the gated namespace.
    const scope = path.posix
      .normalize(rawScope.replace(/[^a-zA-Z0-9._/-]/g, '_'))
      .replace(/^\.?\/+/, '')
      .replace(/\/+$/, '')
    if (!scope || scope === '.' || scope.includes('..')) {
      throw new BadRequestException('Invalid scope')
    }
    const ctx = getReqContext()
    // Scopes whose objects the client later names back to the server key the path
    // on login_id, which the API sets for every request (the local user) and the
    // client cannot choose.
    const requiresVerifiedIdentity = scope === INPAINT_REFERENCE_SCOPE
    if (requiresVerifiedIdentity && !ctx.login_id) {
      throw new UnauthorizedException('Verified identity is required for asset references')
    }
    // The same field the reference check reads back: keying the path on one id
    // while checking another would strand the upload.
    const rawUserId = requiresVerifiedIdentity
      ? ctx.login_id
      : ctx.user_id || ctx.login_id || 'anonymous'
    this.logger.log(
      `[generate-temp-upload-url] scope=${body.scope} fileName=${body.fileName} contentType=${body.contentType} userId=${rawUserId}`,
    )
    // The owned scope uses the injective encoding so the segment this signs and
    // the segment the accept check rebuilds cannot diverge, and so two subjects
    // differing only in escaped characters never share a namespace. Other scopes
    // keep the historical lossy form: their paths are not ownership boundaries
    // and changing them would move existing objects.
    const sanitizedUserId =
      scope === INPAINT_REFERENCE_SCOPE
        ? sanitizeReferenceOwnerId(String(rawUserId))
        : String(rawUserId).replace(/[^a-zA-Z0-9._-]/g, '_')
    const sanitizedFileName = (body.fileName || `file-${timestamp}`).replace(
      /[^a-zA-Z0-9._-]/g,
      '_',
    )
    const relativePath = path.posix.join(
      'tmp',
      sanitizedUserId,
      scope,
      `${timestamp}-${sanitizedFileName}`,
    )
    const fileUri = storeUri(relativePath)

    try {
      const { signedUrl, expiresAt } = await generateUploadSignedUrl(
        fileUri,
        body.contentType,
        15 * 60 * 1000,
      )

      return {
        signedUrl,
        fileUri,
        expiresAt,
      }
    } catch (e) {
      const error = ensureError(e)
      this.logger.error(
        { error, scope, userId: sanitizedUserId },
        'Error generating temp upload URL',
      )
      throw new BadRequestException(`Error generating temp upload URL: ${error.message}`)
    }
  }

  @Post('generate-upload-url/:projectId')
  async generateUploadUrl(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      contentType: string
      fileName: string
      purpose: 'background' | 'override' | 'user_uploaded'
    },
  ) {
    try {
      this.logger.log(
        `Generating upload URL for project: ${projectId}, purpose: ${body.purpose}, org: ${getReqContext().org_id || 'anonymous'}`,
      )

      const storage = new ProjectStore(projectId)
      const timestamp = Date.now()
      const sanitizedFileName = (body.fileName || `file-${timestamp}`).replace(
        /[^a-zA-Z0-9._-]/g,
        '_',
      )
      let relativePath: string

      switch (body.purpose) {
        case 'background': {
          relativePath = path.posix.join(
            SUB_FOLDER.STORYBOARD,
            'background',
            `${timestamp}-${sanitizedFileName}`,
          )
          break
        }
        case 'override': {
          relativePath = path.posix.join(
            SUB_FOLDER.STORYBOARD,
            'override',
            `${timestamp}-${sanitizedFileName}`,
          )
          break
        }
        case 'user_uploaded': {
          relativePath = projectPathResolver.getUserUploadedPath(sanitizedFileName)
          break
        }
        default: {
          relativePath = path.posix.join('uploads', `${timestamp}-${sanitizedFileName}`)
          break
        }
      }
      const fileUri = storage.getFullPath(relativePath)

      // Generate signed URL for upload (15 minutes expiry)
      const { signedUrl, expiresAt } = await generateUploadSignedUrl(
        fileUri,
        body.contentType,
        15 * 60 * 1000,
      )

      this.logger.log(`Upload URL generated successfully for ${fileUri}`)

      return {
        signedUrl,
        fileUri,
        expiresAt,
      }
    } catch (e) {
      const error = ensureError(e)
      this.logger.error({ error, projectId, purpose: body.purpose }, 'Error generating upload URL')

      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof NotFoundException
      ) {
        throw error
      }

      throw new BadRequestException(`Error generating upload URL: ${error.message}`)
    }
  }

  /**
   * List a project's user-uploaded assets.
   *
   * Same check as `serveMediaFile`: the project must belong to the caller (the
   * local user) or the request must carry its share id. Denial is 404, the same
   * answer as for a project that does not exist.
   */
  @Get('attachments/:projectId')
  async getUserUploadedAssets(
    @Param('projectId') projectId: string,
    @Headers('x-reelmakeeasy-shared-id') headerShareId?: string,
    @Query('shareId') shareId?: string,
  ) {
    if (!projectId?.trim()) {
      throw new BadRequestException('projectId is required')
    }
    if (!(await this.projectAccess.canVisitProject(projectId, headerShareId ?? shareId))) {
      throw new NotFoundException('Not found')
    }
    return this.mediaService.getUserUploadedAssets(projectId)
  }

  /**
   * Serve a single file out of a project's own storage prefix.
   *
   * Access is `canVisitProject`: the project belongs to the caller (the local
   * user), or the request carries its share id. Denial is 404 rather than 403,
   * so the route does not reveal whether a project id exists.
   *
   * The share id travels in the `X-REELMAKEEASY-SHARED-ID` header, which `useApi.ts`
   * sends on every call, as the project reads in `projects.controller.ts` take
   * it. The `shareId` query param is a fallback for non-browser callers; the
   * header wins.
   */
  @Get('file/:projectId')
  async serveMediaFile(
    @Param('projectId') projectId: string,
    @Query('fileName') filePath: string,
    @Res() res: Response,
    @Headers('x-reelmakeeasy-shared-id') headerShareId?: string,
    @Query('shareId') shareId?: string,
  ) {
    if (!(await this.projectAccess.canVisitProject(projectId, headerShareId ?? shareId))) {
      throw new NotFoundException(`Not found: ${filePath}`)
    }
    try {
      // Read through the per-project storage abstraction so the project resolves
      // its storage prefix (projects/{projectId}/...).
      this.logger.debug(`Serving file from storage: ${filePath}`)
      const storage = await createStorage(projectId)
      if (!(await storage.exists(filePath))) {
        throw new NotFoundException(`Not found: ${filePath}`)
      }
      const fileBuffer = await storage.readFile(filePath)

      const contentType = this.mediaService.getContentType(filePath)
      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Length', fileBuffer.length.toString())
      // Never `public`: this response is authorized per caller, so a shared cache
      // could store one authorized fetch and replay it to anyone requesting the
      // same URL, bypassing the check above. Access can also be revoked (share
      // deleted, project locked), which a long-lived entry would outlive.
      res.setHeader('Cache-Control', 'private, no-store')
      res.send(fileBuffer)
    } catch (e) {
      const error = ensureError(e)
      if (error instanceof NotFoundException) {
        throw error
      }
      throw new NotFoundException(`Error serving file: ${error.message}`)
    }
  }

  @Post('upload-background/:projectId')
  async uploadBackgroundFile(
    @Param('projectId') projectId: string,
    @Body() body: { fileContentType: string; fileUri: string },
  ) {
    if (!body.fileUri?.trim()) {
      throw new BadRequestException('File store path is required')
    }

    if (!body.fileContentType?.trim()) {
      throw new BadRequestException('File content type is required')
    }

    // Validate file type - only images allowed
    if (!body.fileContentType.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed for background')
    }

    let tempFilePath: string | undefined

    try {
      // Download file from storage
      const fileName = path.basename(body.fileUri)
      tempFilePath = join(process.cwd(), 'tmp', `bg-${Date.now()}-${fileName}`)

      const fileUri = resolveUploadedFileUri(body.fileUri)

      await downloadStoredFileWithRetry(fileUri, tempFilePath, {
        maxRetries: 3,
        timeoutMs: 30000,
      })

      // Save background image with a standard name.
      // Write via the storage abstraction (storage).
      const backgroundFileName = SUMMARY_NAME.DEFAULT_BACKGROUND
      const backgroundPath = `${SUB_FOLDER.STORYBOARD}/${backgroundFileName}`
      const fileBuffer = await readFile(tempFilePath)
      const storage = await createStorage(projectId)
      await storage.writeFile(backgroundPath, fileBuffer)

      return {
        fileName: backgroundFileName,
        path: backgroundPath,
        success: true,
      }
    } catch (e) {
      const error = ensureError(e)
      throw new BadRequestException(`Error uploading background file: ${error.message}`)
    } finally {
      // Clean up temp file
      if (tempFilePath) {
        try {
          await unlink(tempFilePath)
        } catch (_cleanupError) {
          this.logger.warn(`Failed to cleanup temp file: ${tempFilePath}`)
        }
      }
    }
  }

  @Post('upload/:projectId')
  async uploadFile(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      fileContentType: string
      fileUri?: string
      fileName: string
      generateVideoPreview?: boolean
      tempFileUri?: string
      thumbnailPreset?: 'editor' | 'preview'
      uploadToCdn?: boolean
    },
  ) {
    if (!body.fileContentType?.trim()) {
      throw new BadRequestException('File content type is required')
    }

    if (!body.fileName?.trim()) {
      throw new BadRequestException('File name is required')
    }

    if (!body.tempFileUri?.trim() && !body.fileUri?.trim()) {
      throw new BadRequestException('File store path is required')
    }

    const rawUserId = getReqContext().user_id || getReqContext().login_id || 'anonymous'

    try {
      const result = body.tempFileUri?.trim()
        ? await this.mediaService.copyTempFileToProject({
            fileContentType: body.fileContentType,
            fileName: body.fileName,
            projectId,
            tempFileUri: body.tempFileUri,
            userId: String(rawUserId),
          })
        : await this.mediaService.uploadFile(projectId, {
            fileContentType: body.fileContentType,
            fileUri: body.fileUri as string,
            fileName: body.fileName,
            generateVideoPreview: body.generateVideoPreview,
            thumbnailPreset: body.thumbnailPreset,
            uploadToCdn: body.uploadToCdn,
          })
      return result
    } catch (e) {
      const error = ensureError(e)
      throw new BadRequestException(`Error uploading file: ${error.message}`)
    }
  }

  @Post('upload-override/:projectId')
  async uploadOverrideFile(
    @Param('projectId') projectId: string,
    @Body() body: { fileUri: string; path: string },
  ) {
    if (!body.fileUri?.trim()) {
      throw new BadRequestException('File store path is required')
    }

    const validatePath = (pathValue: string | undefined) => {
      if ([SUB_FOLDER.STORYBOARD].includes(pathValue ?? '')) {
        return true
      }
      return false
    }

    if (!validatePath(body.path)) {
      throw new BadRequestException('Invalid path')
    }

    let tempFilePath: string | undefined

    try {
      // Download file from storage
      const fileName = path.basename(body.fileUri)
      tempFilePath = join(process.cwd(), 'tmp', `override-${Date.now()}-${fileName}`)

      const fileUri = resolveUploadedFileUri(body.fileUri)

      await downloadStoredFileWithRetry(fileUri, tempFilePath, {
        maxRetries: 3,
        timeoutMs: 30000,
      })

      // Write via the storage abstraction (storage).
      const overridePath = `${SUB_FOLDER.STORYBOARD}/${SUMMARY_NAME.USER_UPLOADED_STYLE_FILE}`
      const fileBuffer = await readFile(tempFilePath)
      const storage = await createStorage(projectId)
      await storage.writeFile(overridePath, fileBuffer)

      return {
        fileName: SUMMARY_NAME.USER_UPLOADED_STYLE_FILE,
        path: overridePath,
        success: true,
      }
    } catch (e) {
      const error = ensureError(e)
      throw new BadRequestException(`Error uploading override file: ${error.message}`)
    } finally {
      // Clean up temp file
      if (tempFilePath) {
        try {
          await unlink(tempFilePath)
        } catch (_cleanupError) {
          this.logger.warn(`Failed to cleanup temp file: ${tempFilePath}`)
        }
      }
    }
  }
}
