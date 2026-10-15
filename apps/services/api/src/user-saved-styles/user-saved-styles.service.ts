import { randomUUID } from 'node:crypto'

import { type InputJsonValue, PrismaClientKnownRequestError } from '@reelmakeeasy/api-db'
import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  copyStoredFile,
  deleteStoredFile,
  deleteStoredFolder,
  isStoreUri,
  keyIsUnder,
  storedFileKey,
  storeKeyOf,
  storeUri,
  uploadBufferToStore,
} from '@reelmakeeasy/common/storage/stored-files'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import sharp from 'sharp'

import { SCENE_SAMPLE_IDS } from '../media/style-analyzer.prompts'
import { PrismaService } from '../prisma/prisma.service'

import { buildGenerationStyleText, type StyleGenerationParts } from './style-generation-text.util'
import { StyleGenericizeService } from './style-genericize.service'
import { StyleRealismService } from './style-realism.service'
import {
  CreateUserSavedStyleDto,
  ScenePreviewInputDto,
  SnapshotInputDto,
} from './user-saved-styles.dto'

// In-memory shape of one history entry. Matches the embedded `StyleSnapshot`
// composite type; passed straight to Prisma as the snapshots write payload.
interface SnapshotRecord {
  analysis: InputJsonValue | null
  colorPalette: InputJsonValue | null
  createdAt: Date
  id: string
  restoredFromId: null | string
  reusableStylePrompt: string
  scenePreviewUrls: string[]
  summary: null | string
  userRequest: null | string
}

const IMAGE_DATA_URL_REGEX = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\n\r]+)$/

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// Embedded history is capped: each snapshot stores 3 preview images,
// so the cap bounds storage. Only the newest entries are kept.
const SNAPSHOT_CAP = 20

// `thumbnailUrl` may only point at a file this app stores. Class-validator
// decorators on the DTO are not enforced here because the API does not install
// a global ValidationPipe -- guard at the boundary instead so a malicious or
// misbehaving client cannot pin a saved-style row to an arbitrary external
// image source (tracker pixel / IP leak / decoder-bug payload). Returns the
// file's address, which is what the row keeps (served as a URL when read).
function assertAllowedThumbnailUrl(rawUrl: string): string {
  if (isStoreUri(rawUrl)) {
    const key = storeKeyOf(rawUrl)
    if (!key) throw new BadRequestException('thumbnailUrl is not a valid stored file address')
    return storeUri(key)
  }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new BadRequestException('thumbnailUrl is not a valid URL')
  }
  const key = storedFileKey(parsed.toString())
  if (!key) {
    throw new BadRequestException('thumbnailUrl must point at a file stored by this app')
  }
  return storeUri(key)
}

// Coerce the loosely-typed styleMetadata JSON into a record so the analyzer
// pieces (analysis / colorPalette / faceDepiction) can be read for composing
// generationStyleText. Non-objects (null legacy rows, scalars) -> empty.
function readMetadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

@Injectable()
export class UserSavedStylesService {
  private readonly logger = new Logger(UserSavedStylesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly styleGenericize: StyleGenericizeService,
    private readonly styleRealism: StyleRealismService,
  ) {}

  /**
   * Creates a user-saved style. Thumbnail is persisted whenever `imageDataUrl`
   * is provided, regardless of `styleInputMode`. `originalImageUri` is set
   * only for `image` mode; text-mode styles own no original asset.
   */
  async create(dto: CreateUserSavedStyleDto) {
    const reqCtx = getReqContext()
    const userId = reqCtx.login_id
    const orgId = reqCtx.org_id || null

    let thumbnailUrl: string | undefined
    let originalImageUri: string | undefined

    if (dto.styleInputMode === 'image' && !dto.imageDataUrl?.trim()) {
      throw new BadRequestException('imageDataUrl is required for image styles')
    }

    if (dto.imageDataUrl?.trim()) {
      const uploadResult = await this.uploadStyleImages(userId, dto.imageDataUrl, {
        uploadOriginal: dto.styleInputMode === 'image',
      })
      thumbnailUrl = uploadResult.thumbnailUrl
      if (dto.styleInputMode === 'image') {
        originalImageUri = uploadResult.originalImageUri
      }
    } else if (dto.thumbnailUrl?.trim()) {
      // Text-mode styles can also carry a remote CDN thumbnail URL (e.g. a
      // demo template's preview when remixed). Store the URL directly --
      // no re-upload, since the asset already lives on our CDN. Validation
      // (host allowlist) is the load-bearing check; the DTO @IsUrl decorator
      // is decorative because the API has no global ValidationPipe.
      thumbnailUrl = assertAllowedThumbnailUrl(dto.thumbnailUrl.trim())
    }

    // Runtime-guard styleMetadata: the API installs no global ValidationPipe,
    // so the DTO @IsObject decorator is not enforced. Reject anything that
    // isn't a plain JSON object before casting/persisting (arrays, scalars,
    // null wrappers would otherwise be stored as-is).
    const styleMetadata = this.normalizeStyleMetadata(dto.styleMetadata)

    // Validate incoming snapshots BEFORE creating the row so malformed input
    // (no global ValidationPipe) returns 400 instead of leaving an orphan row
    // that a retry would hit with a P2002 name conflict.
    if (dto.snapshots !== undefined && !Array.isArray(dto.snapshots)) {
      throw new BadRequestException('snapshots must be an array')
    }
    for (const snapshot of dto.snapshots ?? []) {
      this.assertValidSnapshotInput(userId, snapshot)
    }

    // Strip brand/subject context from the style before persisting,
    // so a reusable style cannot bake a specific brand into every project it is
    // applied to. Done once here on styleText; generationStyleText derives from
    // the cleaned value below, so both persisted strings are clean.
    // Label the style's realism here, while the reference image is
    // still to hand. A text-only rule is blind to image-built styles (no typed
    // text to match) and silently calls every one of them non-realistic.
    // Issued alongside genericize so the save costs one round-trip, not two.
    // Classified from the raw dto text: brand stripping does not change how
    // real a style looks, and this way neither call waits on the other.
    const [styleText, realismClass] = await Promise.all([
      this.styleGenericize.genericize(dto.styleText),
      this.styleRealism.classify({ styleText: dto.styleText, thumbnailUrl }),
    ])

    // Compose the full generation-time style from the analyzer pieces
    // the client just sent. styleText stays the distilled display prompt; the
    // apply-to-video path reads generationStyleText (falling back to styleText).
    // Both are sanitized -- styleText above, generationStyleText via
    // the helper, which also strips brand text from the metadata sections.
    const meta = readMetadataRecord(styleMetadata)
    const generationStyleText = await this.composeCleanGenerationStyleText({
      analysis: meta.analysis,
      colorPalette: meta.colorPalette,
      faceDepiction: meta.faceDepiction,
      reusableStylePrompt: styleText,
      summary: meta.summary,
    })

    // Persisted into the existing metadata blob, so no schema migration. Left
    // untouched when the classifier failed open (null), which keeps "we did not
    // label this" distinguishable from "we labeled it non-realistic".
    const styleMetadataWithRealism: InputJsonValue | undefined = realismClass
      ? ({ ...readMetadataRecord(styleMetadata), realismClass } as InputJsonValue)
      : styleMetadata

    let created
    try {
      created = await this.prisma.userSavedStyle.create({
        data: {
          generationStyleText,
          name: dto.name.trim(),
          orgId,
          originalImageUri,
          styleInputMode: dto.styleInputMode,
          styleMetadata: styleMetadataWithRealism,
          styleText: styleText.trim(),
          thumbnailUrl,
          userId,
        },
      })
    } catch (error) {
      const prismaError = ensureError<PrismaClientKnownRequestError>(error)
      if (prismaError.code === 'P2002') {
        throw new ConflictException('A saved style with this name already exists')
      }
      throw prismaError
    }

    // Flush any client-side history: the style id is only known now,
    // so previews are promoted to their durable path and written in a second
    // step. Intentionally ungated -- create is shared with legacy SCC saves; the
    // snapshots payload is additive and lands only in the caller's own namespace.
    // If the promote/persist fails (e.g. storage hiccup) the row is already saved, so
    // we keep it snapshot-less rather than throw and strand the client on a 500
    // that a retry would turn into a 409 name conflict.
    if (!dto.snapshots?.length) {
      return created
    }
    try {
      // Only the newest SNAPSHOT_CAP survive, so promote just those -- avoids a
      // 3xN storage fan-out when a client flushes a long pre-save history.
      const toFlush = dto.snapshots.slice(-SNAPSHOT_CAP)
      const records = await this.buildSnapshotsFromInputs(created.id, userId, toFlush)
      return await this.prisma.userSavedStyle.update({
        where: { id: created.id },
        data: { snapshots: records },
      })
    } catch (error) {
      // A snapshot promote/persist failed partway. Earlier snapshots in the
      // batch may have already copied blobs under this brand-new style's prefix;
      // best-effort nuke the whole prefix so nothing is orphaned, then return the
      // (snapshot-less) created row.
      await deleteStoredFolder(storeUri(`custom-style/${userId}/${created.id}`)).catch(
        () => undefined,
      )
      this.logger.warn(
        { error: ensureError(error), styleId: created.id },
        'Saved style created but failed to persist initial snapshots',
      )
      return created
    }
  }

  async delete(id: string) {
    const style = await this.findById(id)
    if (!style) {
      throw new NotFoundException('Saved style not found or access denied')
    }

    return this.prisma.userSavedStyle.delete({
      where: { id },
    })
  }

  async findAllByUser() {
    const reqCtx = getReqContext()
    const styles = await this.prisma.userSavedStyle.findMany({
      orderBy: { createdAt: 'desc' },
      where: {
        OR: this.buildOrgScope(reqCtx.org_id || null),
        userId: reqCtx.login_id,
      },
    })
    // Origin for the reuse funnel new-vs-legacy split: styleMetadata is
    // written in the INITIAL create, so it survives a later snapshot-promotion
    // failure (which returns a snapshot-less row); the legacy LongTakeStylePicker
    // persists neither metadata nor snapshots. Either studio artifact => 'studio'.
    // Computed on read, so existing rows get it for free.
    return styles.map((style) => {
      // `realismClass` is written into styleMetadata on EVERY save, legacy
      // included, so bare metadata presence no longer implies studio origin.
      // Only analyzer-written keys count. (The studio always sends at least one
      // -- analysis / summary / colorPalette -- so nothing is misread here.)
      const hasStudioMetadata = Object.keys(readMetadataRecord(style.styleMetadata)).some(
        (key) => key !== 'realismClass',
      )
      const hasStudioArtifacts =
        hasStudioMetadata || (Array.isArray(style.snapshots) && style.snapshots.length > 0)
      return { ...style, createdVia: hasStudioArtifacts ? 'studio' : 'legacy' }
    })
  }

  async findById(id: string) {
    const reqCtx = getReqContext()
    return this.prisma.userSavedStyle.findFirst({
      where: {
        id,
        OR: this.buildOrgScope(reqCtx.org_id || null),
        userId: reqCtx.login_id,
      },
    })
  }

  /**
   * Record that a saved style produced a project.
   *
   * The render path never learns which saved style it was handed -- it gets
   * styleText and nothing else -- so this row is the only link between a style
   * and the videos made with it. It is what makes reuse depth answerable.
   *
   * Idempotent: re-applying the same style to the same project is one use, and
   * the client may retry. The realism label is snapshot here rather than read
   * later, because editing a style reclassifies it and the video was made with
   * the label as it stood.
   */
  async recordUse(id: string, projectId: string) {
    const trimmedProjectId = projectId?.trim()
    if (!trimmedProjectId) {
      throw new BadRequestException('projectId is required')
    }
    // Ownership check, so a caller cannot attribute someone else's style.
    const style = await this.findById(id)
    if (!style) {
      throw new NotFoundException('Saved style not found or access denied')
    }

    const meta = readMetadataRecord(style.styleMetadata)
    const realismClass = typeof meta.realismClass === 'string' ? meta.realismClass : undefined

    return this.prisma.userSavedStyleUse.upsert({
      create: {
        orgId: style.orgId,
        projectId: trimmedProjectId,
        realismClass,
        savedStyleId: id,
        userId: style.userId,
      },
      // A second apply is the same use. Refresh the label only -- the style may
      // have been edited between applies, and the latest apply is the truth for
      // this project.
      update: { realismClass },
      where: { savedStyleId_projectId: { projectId: trimmedProjectId, savedStyleId: id } },
    })
  }

  async update(id: string, data: { name?: string; styleText?: string }) {
    const style = await this.findById(id)
    if (!style) {
      throw new NotFoundException('Saved style not found or access denied')
    }

    const updateData: {
      generationStyleText?: null | string
      name?: string
      styleMetadata?: InputJsonValue
      styleText?: string
    } = {}
    if (data.name !== undefined) {
      updateData.name = data.name.trim()
    }
    if (data.styleText !== undefined) {
      // Sanitize on edit, and rebuild generationStyleText from the
      // cleaned prompt -- otherwise the render-preferred field stays stale (and
      // possibly still branded) after a styleText edit.
      // Reclassify on the same edit. A style rewritten from
      // "claymation" to "photoreal drone footage" would otherwise keep its
      // original label forever and the metric would report the pre-edit style.
      const [cleanedRaw, realismClass] = await Promise.all([
        this.styleGenericize.genericize(data.styleText),
        this.styleRealism.classify({
          styleText: data.styleText,
          thumbnailUrl: style.thumbnailUrl ?? undefined,
        }),
      ])
      const cleaned = cleanedRaw.trim()
      updateData.styleText = cleaned
      const meta = readMetadataRecord(style.styleMetadata)
      if (realismClass) {
        updateData.styleMetadata = { ...meta, realismClass } as InputJsonValue
      }
      updateData.generationStyleText = await this.composeCleanGenerationStyleText({
        analysis: meta.analysis,
        colorPalette: meta.colorPalette,
        faceDepiction: meta.faceDepiction,
        reusableStylePrompt: cleaned,
        summary: meta.summary,
      })
    }

    try {
      return await this.prisma.userSavedStyle.update({
        where: { id },
        data: updateData,
      })
    } catch (error) {
      const prismaError = ensureError<PrismaClientKnownRequestError>(error)
      if (prismaError.code === 'P2002') {
        throw new ConflictException('A saved style with this name already exists')
      }
      throw prismaError
    }
  }

  async updateThumbnail(id: string, imageDataUrl: string) {
    const style = await this.findById(id)
    if (!style) {
      throw new NotFoundException('Saved style not found or access denied')
    }

    const uploadResult = await this.uploadStyleImages(style.userId, imageDataUrl, {
      uploadOriginal: true,
    })

    return this.prisma.userSavedStyle.update({
      where: { id },
      data: {
        originalImageUri: uploadResult.originalImageUri,
        thumbnailUrl: uploadResult.thumbnailUrl,
      },
    })
  }

  async updateThumbnailFromUrl(id: string, rawUrl: string) {
    const style = await this.findById(id)
    if (!style) {
      throw new NotFoundException('Saved style not found or access denied')
    }

    const validatedUrl = assertAllowedThumbnailUrl(rawUrl)

    return this.prisma.userSavedStyle.update({
      where: { id },
      data: { thumbnailUrl: validatedUrl },
    })
  }

  /**
   * Guard a snapshot payload at the boundary (the API has no global
   * ValidationPipe, so the DTO decorators are decorative). Throws 400 for
   * malformed input -- non-empty reusableStylePrompt, scenePreviews an array,
   * each preview a well-formed own-namespace CDN URL -- so a bad request never
   * reaches buildSnapshot's `.trim()` (500) nor a half-promoted write.
   */
  private assertValidSnapshotInput(userId: string, input: SnapshotInputDto): void {
    if (!input?.reusableStylePrompt?.trim()) {
      throw new BadRequestException('reusableStylePrompt is required')
    }
    if (!Array.isArray(input.scenePreviews)) {
      throw new BadRequestException('scenePreviews must be an array')
    }
    for (const preview of input.scenePreviews) {
      if (!preview?.archetypeId?.trim() || !preview?.imageUrl?.trim()) {
        throw new BadRequestException('each scenePreview requires archetypeId and imageUrl')
      }
      // Pre-flight the URL guard so a bad / cross-user URL is a 400 here rather
      // than a failure swallowed by the create-flush try/catch.
      this.storeUriFromUrl(userId, preview.imageUrl)
    }
  }

  private buildOrgScope(orgId: null | string): Array<{ orgId: null | string }> {
    if (!orgId) {
      return [{ orgId: null }]
    }

    return [{ orgId }, { orgId: null }]
  }

  /** Assemble one in-memory snapshot record with a fresh id + timestamp. */
  private buildSnapshot(
    snapshotId: string,
    input: SnapshotInputDto,
    scenePreviewUrls: string[],
  ): SnapshotRecord {
    return {
      analysis: (input.analysis as InputJsonValue) ?? null,
      colorPalette: (input.colorPalette as InputJsonValue) ?? null,
      createdAt: new Date(),
      id: snapshotId,
      reusableStylePrompt: input.reusableStylePrompt.trim(),
      restoredFromId: null,
      scenePreviewUrls,
      summary: input.summary ?? null,
      userRequest: input.userRequest?.trim() || null,
    }
  }

  /** Promote each input snapshot's previews and build its persisted record. */
  private async buildSnapshotsFromInputs(
    styleId: string,
    userId: string,
    inputs: SnapshotInputDto[],
  ): Promise<SnapshotRecord[]> {
    return Promise.all(
      inputs.map(async (input) => {
        const snapshotId = randomUUID()
        const scenePreviewUrls = await this.promoteScenePreviews(
          userId,
          styleId,
          snapshotId,
          input.scenePreviews,
        )
        // Sanitize the snapshot prompt on the create-time flush too;
        // buildResultFromDetail prefers the latest snapshot's prompt on reopen.
        const reusableStylePrompt = await this.styleGenericize.genericize(input.reusableStylePrompt)
        return this.buildSnapshot(snapshotId, { ...input, reusableStylePrompt }, scenePreviewUrls)
      }),
    )
  }

  /**
   * Compose generationStyleText and strip brand/subject context from
   * it. generationStyleText is the field the apply-to-video path prefers, and
   * it can carry brand text via the analyzer metadata sections (intent, summary,
   * faceDepiction) even when the prompt itself is clean -- so genericize the
   * whole composed string. `reusableStylePrompt` in `parts` is expected to be
   * already genericized; the extra LLM call is skipped when the composition adds
   * nothing beyond that clean prompt (the common text-mode case).
   */
  private async composeCleanGenerationStyleText(
    parts: StyleGenerationParts,
  ): Promise<null | string> {
    const raw = buildGenerationStyleText(parts)
    if (!raw) {
      return null
    }
    const prompt =
      typeof parts.reusableStylePrompt === 'string' ? parts.reusableStylePrompt.trim() : ''
    return raw.trim() === prompt ? prompt || null : this.styleGenericize.genericize(raw)
  }

  /**
   * Reverse a scene-preview file URL back to its store address so the blob can be
   * copied/deleted. Guards: must be a file this app stores, under the caller's
   * own `custom-style/{userId}/` prefix -- a client cannot smuggle in an
   * arbitrary or cross-user object path. Mirrors `assertAllowedThumbnailUrl`.
   */
  private storeUriFromUrl(userId: string, rawUrl: string): string {
    let objectPath: string | undefined
    if (isStoreUri(rawUrl)) {
      objectPath = storeKeyOf(rawUrl)
    } else {
      let parsed: URL
      try {
        parsed = new URL(rawUrl)
      } catch {
        throw new BadRequestException('scene preview imageUrl is not a valid URL')
      }
      objectPath = storedFileKey(parsed.toString())
    }
    if (!objectPath) {
      throw new BadRequestException(
        'scene preview imageUrl must point at a file stored by this app',
      )
    }
    if (!keyIsUnder(objectPath, `custom-style/${userId}`)) {
      throw new BadRequestException('scene preview imageUrl is outside the user style namespace')
    }
    return storeUri(objectPath)
  }

  /**
   * Validate the optional `styleMetadata` before persisting. Returns the value
   * as a Prisma JSON input when it is a plain object, `undefined` when absent,
   * and throws for any non-object payload (array / scalar / null). Guards the
   * column at the boundary since the API runs no global ValidationPipe.
   */
  private normalizeStyleMetadata(value: unknown): InputJsonValue | undefined {
    if (value === undefined || value === null) {
      return undefined
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('styleMetadata must be a JSON object')
    }
    return value as InputJsonValue
  }

  private parseImageDataUrl(imageDataUrl: string): {
    buffer: Buffer
    extension: string
    mimeType: string
  } {
    const match = imageDataUrl.match(IMAGE_DATA_URL_REGEX)
    if (!match) {
      throw new BadRequestException('Invalid imageDataUrl format')
    }

    const [, mimeType, base64Data] = match
    const buffer = Buffer.from(base64Data, 'base64')
    if (!buffer.length) {
      throw new BadRequestException('Invalid imageDataUrl payload')
    }

    return {
      buffer,
      extension: MIME_TYPE_TO_EXTENSION[mimeType] || 'png',
      mimeType,
    }
  }

  /**
   * Promote the ephemeral scene-preview blobs to a durable per-style/per-snapshot
   * path and return their permanent CDN URLs, ordered by SCENE_SAMPLE_IDS.
   * Previews absent from the input (or for unknown scene ids) are skipped.
   */
  private async promoteScenePreviews(
    userId: string,
    styleId: string,
    snapshotId: string,
    scenePreviews: ScenePreviewInputDto[],
  ): Promise<string[]> {
    const byArchetype = new Map(scenePreviews.map((p) => [p.archetypeId, p.imageUrl]))
    // Surface typo'd / unknown scene ids: they would otherwise be silently
    // dropped (we only iterate the known scene ids below), losing a preview
    // with no signal.
    const knownSceneIds = new Set<string>(SCENE_SAMPLE_IDS)
    for (const id of byArchetype.keys()) {
      if (!knownSceneIds.has(id)) {
        this.logger.warn({ archetypeId: id }, 'Dropping scene preview for unknown scene id')
      }
    }

    const destPath = (sceneId: string) =>
      `custom-style/${userId}/${styleId}/${snapshotId}/${sceneId}.png`

    // allSettled (not Promise.all) so every copy finishes before we clean up: an early reject
    // would let the cleanup race siblings still landing, leaving orphan blobs.
    const results = await Promise.allSettled(
      SCENE_SAMPLE_IDS.map(async (sceneId) => {
        const imageUrl = byArchetype.get(sceneId)
        if (!imageUrl?.trim()) {
          return undefined
        }
        const sourceUri = this.storeUriFromUrl(userId, imageUrl)
        await copyStoredFile(sourceUri, storeUri(destPath(sceneId)))
        // The row keeps the address; the URL is built when the style is read.
        return storeUri(destPath(sceneId)) as string
      }),
    )

    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failure) {
      // A copy failed: every sibling that landed is an orphan under this snapshot path (the
      // snapshot is never written). All copies have settled, so no in-flight copy can re-land
      // after these deletes. Best-effort delete every candidate dest, then rethrow.
      await Promise.all(
        SCENE_SAMPLE_IDS.filter((id) => byArchetype.get(id)?.trim()).map((id) =>
          deleteStoredFile(storeUri(destPath(id))).catch(() => undefined),
        ),
      )
      throw failure.reason
    }

    return results
      .map((r) => (r.status === 'fulfilled' ? r.value : undefined))
      .filter((u): u is string => Boolean(u))
  }

  private async uploadStyleImages(
    userId: string,
    imageDataUrl: string,
    options: { uploadOriginal?: boolean } = {},
  ) {
    const { buffer: originalBuffer, extension, mimeType } = this.parseImageDataUrl(imageDataUrl)
    const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const thumbnailStorePath = `user-saved-styles/${userId}/${timestamp}.webp`

    const thumbnailBuffer = await sharp(originalBuffer)
      .resize({
        width: 400,
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer()

    const thumbnailUri = storeUri(thumbnailStorePath)
    const uploads: Array<Promise<unknown>> = [
      uploadBufferToStore(thumbnailBuffer, thumbnailUri, {
        contentType: 'image/webp',
      }),
    ]

    let originalImageUri: string | undefined
    if (options.uploadOriginal) {
      const originalStorePath = `user-saved-styles/${userId}/originals/${timestamp}.${extension}`
      originalImageUri = storeUri(originalStorePath)
      uploads.push(
        uploadBufferToStore(originalBuffer, originalImageUri, {
          contentType: mimeType,
        }),
      )
    }

    await Promise.all(uploads)

    return {
      originalImageUri,
      thumbnailUrl: thumbnailUri,
    }
  }
}
