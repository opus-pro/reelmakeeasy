import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { Content } from '@reelmakeeasy/common/llm'
import { downscaleToLongEdge, flattenAlphaToContrastingPng } from '@reelmakeeasy/uip-planner-runtime'

import { downloadAssetToLocal, formatError, formatLogFields, logger } from './common'

// Longest-edge cap for user-asset understanding images. Matches UIP's
// DESCRIBE_IMAGE_MAX_LONG_EDGE (describe-uploaded-images.ts): Gemini tiles image
// input into 768x768 tiles (~258 tokens each), so pixels beyond what a short
// factual caption needs only inflate tokens -> latency, and oversized
// requests can time out.
// Keep in sync with the UIP value.
export const USER_ASSET_UNDERSTANDING_MAX_LONG_EDGE = 1536

/**
 * Build the `image_url` content block for the user-asset understanding call.
 * Downloads the asset and applies the SAME normalization UIP's
 * `describe_uploaded_images` uses -- flatten alpha onto white, then downscale to
 * {@link USER_ASSET_UNDERSTANDING_MAX_LONG_EDGE} -- via the shared
 * `@reelmakeeasy/uip-planner-runtime` helpers, then inlines it as a base64 data URL.
 * Best-effort: any failure (download, decode, resize) logs a warning and falls
 * back to the original `storageUri` -- the exact legacy behavior -- so a
 * single bad asset never breaks the call.
 *
 * @example
 * ```ts
 * const content = await buildUserAssetUnderstandingImageContent({
 *   mime: item.mime,
 *   storageUri: item.storageUri,
 * })
 * ```
 */
export async function buildUserAssetUnderstandingImageContent(item: {
  mime: string
  storageUri: string
}): Promise<Content> {
  let tmpDir: string | undefined
  try {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lt-user-asset-'))
    const localPath = path.join(tmpDir, 'source')
    await downloadAssetToLocal(item.storageUri, localPath)
    const imageBuffer = await fs.promises.readFile(localPath)
    const { buffer: flattened, changed } = await flattenAlphaToContrastingPng(imageBuffer)
    const { buffer } = await downscaleToLongEdge(flattened, USER_ASSET_UNDERSTANDING_MAX_LONG_EDGE)
    // `changed` means the flatten re-encoded to PNG; otherwise downscaleToLongEdge
    // preserves the source format, so the original MIME still applies.
    const mimeType = changed ? 'image/png' : item.mime || 'image/jpeg'
    return { imageUrl: `data:${mimeType};base64,${buffer.toString('base64')}`, type: 'image_url' }
  } catch (error) {
    logger.warn(
      `[long-take] user-asset image downscale failed, sending original uri ${formatLogFields({
        err: formatError(error),
        storageUri: item.storageUri,
      })}`,
    )
    return { imageUrl: item.storageUri, type: 'image_url' }
  } finally {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { force: true, recursive: true }).catch(() => undefined)
    }
  }
}
