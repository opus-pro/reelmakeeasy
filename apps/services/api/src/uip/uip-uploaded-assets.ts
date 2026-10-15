import { createHash } from 'node:crypto'
import * as path from 'node:path'

import { BadRequestException } from '@nestjs/common'
import { projectPathResolver } from '@reelmakeeasy/common/agent-v2/util/project-path-resolver'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  copyStoredFile,
  isStoreUri,
  parseStoreUri,
  storeUri,
} from '@reelmakeeasy/common/storage/stored-files'

import { rasterizeForLlm, shouldRasterizeForLlm } from '../util/rasterize-upload-for-llm'
import { sanitizeUploadFileName } from '../util/sanitize-upload-file-name'

import type { UploadFileDescriptorDto } from './uip.dto'
import { recordUrlMapping } from './uip-response-helpers'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

const logger = createSubLogger('uip-service')

export type UipUploadedAsset = {
  asset_id: string
  content_type: string
  file_name: string
  file_path: string
  uploaded_at: string
}

export type UipUploadedAssetInput = Omit<UipUploadedAsset, 'uploaded_at'> & { uploaded_at?: string }

export function assertImageUploadDescriptors(files: UploadFileDescriptorDto[]): void {
  for (const file of files) {
    if (!file.contentType?.startsWith('image/')) {
      throw new BadRequestException(
        `Only image uploads are allowed. Unsupported contentType: ${file.contentType}`,
      )
    }
  }
}

export function assertImageUploadedAssets(
  assets: UipUploadedAsset[] | undefined,
  fieldName: string,
): void {
  for (const asset of assets ?? []) {
    if (!asset.content_type?.startsWith('image/')) {
      throw new BadRequestException(
        `Only image uploads are allowed in ${fieldName}. Unsupported content_type: ${asset.content_type}`,
      )
    }
  }
}

export async function resolveUploadedAssetsForProject(
  projectId: string,
  assets?: readonly UipUploadedAssetInput[],
): Promise<{
  resolvedAssets: UipUploadedAsset[] | undefined
  urlMap: Map<string, string>
}> {
  const urlMap = new Map<string, string>()
  if (!assets?.length) {
    return { resolvedAssets: undefined, urlMap }
  }

  const now = new Date().toISOString()
  const normalized = assets.map((asset) => ({
    ...asset,
    uploaded_at: asset.uploaded_at ?? now,
  }))
  const resolvedResults = await Promise.all(
    normalized.map(async (asset) => {
      const isTempPath = isStoreUri(asset.file_path) || asset.file_path.startsWith('tmp/')

      if (!isTempPath) {
        return { asset }
      }

      // Declared outside the try so the catch branch can still reference it
      // when the throw originates from `sanitizeAssetIdForPath` itself (e.g.
      // `encodeURIComponent` throws on malformed UTF-16 input).
      let safeAssetIdSegment: string | undefined
      try {
        safeAssetIdSegment = sanitizeAssetIdForPath(asset.asset_id)
        // SVG / HEIC / HEIF / AVIF / TIFF aren't accepted by vision LLMs
        // (OpenAI + Gemini both reject with HTTP 400). Rasterize at promote
        // time so every downstream prompt (describe_uploaded_images, anchor
        // generation, etc.) sees a PNG with the same content.
        if (shouldRasterizeForLlm({ contentType: asset.content_type, fileName: asset.file_name })) {
          const sourceBuffer = await readAssetBytes(asset.file_path)
          const out = await rasterizeForLlm(sourceBuffer, asset.file_name)
          const destRelative = `uploads/${safeAssetIdSegment}/${out.fileName}`
          const destFull = `projects/${projectId}/user-intent-planner/${destRelative}`
          const destUri = storeUri(destFull)
          await fileStore.file(destFull).write(out.buffer, { contentType: out.contentType })
          logger.info(
            `[${projectId}] Rasterized + uploaded ${asset.asset_id} ${asset.file_name} -> ${out.fileName}`,
          )
          return {
            asset: {
              ...asset,
              content_type: out.contentType,
              file_name: out.fileName,
              file_path: destRelative,
            },
            mapping: { from: asset.file_path, to: destUri },
          }
        }

        const destRelative = `uploads/${safeAssetIdSegment}/${asset.file_name}`
        const destFull = `projects/${projectId}/user-intent-planner/${destRelative}`
        const destUri = storeUri(destFull)
        if (isStoreUri(asset.file_path)) {
          await copyStoredFile(asset.file_path, destUri)
        } else {
          await fileStore.file(asset.file_path).copyTo(destFull)
        }

        logger.info(`[${projectId}] Copied temp asset ${asset.asset_id} to ${destFull}`)
        return {
          asset: { ...asset, file_path: destRelative },
          mapping: { from: asset.file_path, to: destUri },
        }
      } catch (err) {
        // Drop the asset. The original `return { asset }` fallback (which
        // preserved the source `store://...` / `tmp/...` path) was safe when the
        // try-body only ran `copyStoredFile` -- a server-side copy that fails
        // for infra reasons, leaving the source intact and the original path
        // legitimately readable. After we added a content-decoding
        // rasterize step (sharp/libheif) and wired
        // mode-confirmation-multimodal + describe_uploaded_images to read
        // `asset.file_path` via a project-scoped storage instance, the
        // fallback became unsafe: a `store://...` path passed to
        // `AbstractStorage.resolve()` gets concatenated onto the project
        // root, storage replies "No such object", and the planner hangs out the
        // bootstrap loop. Surface the failure
        // (ERROR) and drop the asset so downstream consumers never see a
        // poisoned reference. The filter below collapses null returns into
        // a `droppedCount` warn + an omission from `resolvedAssets`; the
        // function's public return shape is always non-null.
        logger.error(
          {
            err: ensureError(err),
            projectId,
            asset_id: asset.asset_id,
            sanitized_asset_id: safeAssetIdSegment,
            // `asset.file_path` carries the uploader's user-id segment
            // (`tmp/user_01KQ.../...`). Log only the basename so the logs
            // still get enough to tell HEIC-vs-PNG apart without
            // capturing PII.
            file_path_basename: path.posix.basename(asset.file_path),
          },
          `[${projectId}] Failed to promote temp asset; dropping`,
        )
        return null
      }
    }),
  )

  const droppedCount = resolvedResults.filter((item) => item === null).length
  if (droppedCount > 0) {
    logger.warn(
      `[${projectId}] Dropped ${droppedCount} of ${normalized.length} uploaded asset(s) due to promote failures`,
    )
  }

  const resolved: UipUploadedAsset[] = []
  for (const item of resolvedResults) {
    if (item === null) {
      continue
    }
    resolved.push(item.asset)
    if (item.mapping) {
      recordUrlMapping(urlMap, item.mapping.from, item.mapping.to)
    }
  }

  return { resolvedAssets: resolved, urlMap }
}

// When a user references an image carried over from a previous project, the
// frontend can hand us an `asset_id` that is actually a full URL or path
// (e.g. `https://cdn.../projects/<old_project>/.../uploads/<slug>/<filename>`).
// Blindly interpolating that into a stored file path produces double-prefixed
// destinations the bucket can't satisfy. Reduce arbitrary input to a single
// safe path segment: keep only the trailing non-empty segment, percent-encode
// any character that isn't safe in a stored file name component, and append a
// short hash of the full raw id so distinct sources that share a basename
// don't collapse to the same destination path.
export function sanitizeAssetIdForPath(rawAssetId: string): string {
  const lastSegment = rawAssetId.split('/').findLast(Boolean) ?? rawAssetId
  const suffix = createHash('sha256').update(rawAssetId).digest('hex').slice(0, 12)
  return `${encodeURIComponent(lastSegment)}-${suffix}`
}

/** The bytes of a stored file, named by its address or its key (both checked). */
async function readAssetBytes(fileUri: string): Promise<Buffer> {
  return fileStore.file(fileUri).read()
}

// Mirror of MediaService's AUDIO_EXTENSIONS set (media.service.ts:39-49).
// Used to detect when the user uploaded a recognizable audio file so the
// helper can preserve the extension across sanitization (e.g. trailing
// whitespace in 'clip.mp3 ' would otherwise be replaced with '_', producing
// '.mp3_' which the scanner does not recognize as audio).
const KNOWN_AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.opus',
  '.wav',
  '.webm',
  '.wma',
])

/**
 * Copy a raw user audio upload from a temp store path into the project's
 * canonical `user_uploaded/` folder. Matches the classic Story Mode
 * convention so downstream Remix / Share / demo readers pick it up
 * without any code changes (see `MediaService.scanUserUploadedAssetsFromStore`,
 * `resolveUserUploadedAudioUrl` for demo enrichment, and the demo
 * user-uploaded sync utility).
 *
 * Returns undefined on failure; caller should fall back to the original
 * `audioPath` so session-init is not made brittle.
 *
 * Contract test: `apps/services/api/src/media/upload-to-reader-contract.test.ts`
 * pins the helper's destination path against the scanner. If you change
 * what this function writes (sanitization, extension fallback, dest folder),
 * extend the matrix there or the next Remix / Share regression slips
 * through code review the same way an earlier one did.
 */
export async function copyAudioUploadToProject(
  projectId: string,
  audioPath: string,
): Promise<undefined | { destUri: string; destRelative: string }> {
  try {
    // Source validation: the one parser refuses path traversal (`..` segments, also
    // encoded), hidden and empty segments. Matches the existing long-take
    // resolveAudioPath posture. Cross-project copies are allowed (remix carry-over).
    // Check `..` per path segment, not as a substring: filenames like
    // 'take..final.mp3' contain '..' but are not traversal segments.
    if (audioPath.split('/').includes('..')) {
      throw new Error('Invalid audio path: traversal not allowed')
    }
    const sourceObject = isStoreUri(audioPath) ? parseStoreUri(audioPath) : audioPath
    // Node's path.posix.basename strips trailing slashes ('tmp/foo/' -> 'foo'),
    // so we have to short-circuit ourselves to actually reach the fallback.
    const sourceBasename = sourceObject.endsWith('/') ? '' : path.posix.basename(sourceObject)
    // Extract the original audio extension *before* sanitization, since the
    // sanitizer may mangle it. Example: 'clip.mp3 ' (trailing whitespace) has
    // extname '.mp3 ', which trims to '.mp3' and is recognized as audio, but
    // sanitizing the whole basename produces 'clip.mp3_' whose '.mp3_'
    // extension the scanner classifier silently drops.
    const rawExt = path.posix.extname(sourceBasename)
    const normalizedExt = rawExt.toLowerCase().trim()
    const isKnownAudio = KNOWN_AUDIO_EXTENSIONS.has(normalizedExt)
    const sourceStem = isKnownAudio
      ? sourceBasename.slice(0, sourceBasename.length - rawExt.length)
      : sourceBasename
    // Strip leading dots so the file isn't treated as a dotfile by the scanner
    // (`MediaService.scanUserUploadedAssetsFromStore` skips entries starting with
    // '.') and so dot-only basenames like '.' / '..' don't collapse through
    // path.posix.join into the parent directory.
    const sanitizedStem = sanitizeUploadFileName(sourceStem).replace(/^\.+/, '')
    const reconstructed =
      isKnownAudio && sanitizedStem ? `${sanitizedStem}${normalizedExt}` : sanitizedStem
    // Need a real extension: the scanner classifier returns early when
    // `path.posix.extname(name)` is empty. `'foo.'` produces `.` which is in
    // neither AUDIO_EXTENSIONS nor IMAGE_VIDEO_EXTENSIONS, so the file would
    // be silently dropped. Fall back to a known-good name in both cases.
    const finalExt = path.posix.extname(reconstructed)
    const safeName = reconstructed && finalExt && finalExt !== '.' ? reconstructed : 'audio.mp3'

    const destRelative = projectPathResolver.getUserUploadedPath(safeName)
    const destFull = `projects/${projectId}/${destRelative}`
    const destUri = storeUri(destFull)

    if (isStoreUri(audioPath)) {
      await copyStoredFile(audioPath, destUri)
    } else {
      await fileStore.file(audioPath).copyTo(destFull)
    }

    logger.info(`[${projectId}] Copied user audio to ${destFull}`)
    return { destUri, destRelative }
  } catch (err) {
    logger.warn(
      `[${projectId}] Failed to copy user audio from ${audioPath}: ${err}. Falling back to original path.`,
    )
    return undefined
  }
}
