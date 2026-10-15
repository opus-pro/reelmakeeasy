/**
 * Staged-asset format normalization for the web crawlers (brand extraction,
 * article extraction).
 *
 * Vision LLMs (Gemini, OpenAI) decode a narrow set of raster formats. AVIF is
 * not one of them, but the crawler happily stages it: `guessExtension` maps an
 * `image/avif` Content-Type, and `isDecodableRasterImage` accepts the AVIF
 * `ftyp` box. The bytes are perfectly valid; the provider simply cannot read
 * them, and answers `400 The image data you provided does not represent a
 * valid image`.
 *
 * Nothing downstream rescues it reliably. An AVIF that happens to carry an
 * alpha channel is incidentally transcoded to PNG by
 * `flattenAlphaToContrastingPng`, so it works by accident; an opaque one keeps
 * its AVIF bytes all the way to the wire and fails. Meanwhile
 * `isMultimodalImageMimeType` excludes `image/avif` outright, so on the anchor
 * path the asset is filtered out of the payload and silently contributes
 * nothing at all.
 *
 * Normalizing here -- at the moment the crawler writes the asset to storage --
 * gives every later phase a format it can actually read, and mirrors what the
 * SVG raster and the shared-asset upload path's `rasterizeForLlm`
 * already do at their own intakes.
 *
 * The sniff is on the bytes, not the guessed extension, so a body whose real
 * format disagrees with its Content-Type (a WebP served as `image/avif`) is
 * also stored under the extension that matches what is actually in the file.
 *
 * This never drops an asset. Deciding what is or isn't an image stays with the
 * caller's `isDecodableRasterImage` magic-byte guard; formats sharp cannot read
 * at all (ICO, notably) pass through exactly as they do today rather than
 * silently disappearing from the bank.
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import sharp from 'sharp'

const logger = createSubLogger('brand-extraction:crawl')

/**
 * sharp `metadata().format` values that multimodal LLMs accept as image input,
 * mapped to the file extension we store them under.
 *
 * The same knowledge already exists keyed by MIME / extension in
 * `MULTIMODAL_IMAGE_MIME_TYPES` (anchor-utils), `isLlmCompatibleImageAsset`
 * (llm-image-mime), and `LLM_INCOMPATIBLE_MIMES` (the api-side
 * rasterize-upload-for-llm) -- between them the filters that drop these bytes
 * from describe_uploaded_images, the anchor asset-manager, and the Phase B
 * prompt-spec. This copy is keyed on what sharp actually sniffed rather than on
 * a claimed label, which is the point: it is what lets a mislabelled body be
 * stored under the extension its bytes deserve. Note sharp reports AVIF as
 * `heif`, so both fall through to the transcode below.
 */
const LLM_SAFE_FORMAT_EXTENSIONS: Record<string, string> = {
  gif: 'gif',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
}

// Bounds for the transcode, matching the api-side `rasterizeForLlm`, which
// solves the same problem at the upload intake. PNG is lossless, so a
// high-resolution source amplifies hard on re-encode (~11x on the assets that
// prompted this). Article extraction stages up to 24 images through one
// `Promise.all`, so an unbounded encode is a worker-OOM risk, and Phase B
// base64-inlines the result at full resolution into a provider payload.
//
// 2048 on the long edge is well past what any vision model resolves (the
// understanding path downscales to 1536 anyway) and past what a passthrough
// article photo needs. The pixel cap is the decompression-bomb guard: crawled
// bytes are untrusted, and a crafted 20KB AVIF can declare a huge canvas.
// Neither bound touches an already-LLM-safe source, which passes through
// untranscoded.
const MAX_RASTER_DIMENSION = 2048
const MAX_INPUT_PIXELS = 268_435_456 // 256 MP (~16384 x 16384)

export interface NormalizedStagedRaster {
  buffer: Buffer
  ext: string
}

/**
 * Coerce staged image bytes into a format a vision LLM can decode.
 *
 * Returns the source bytes with the extension corrected to match them when the
 * format is already LLM-safe, and PNG-transcoded bytes when it is not. Bytes
 * sharp cannot sniff or re-encode are returned untouched under the caller's
 * original extension.
 */
export async function normalizeStagedRasterForLlm(
  buffer: Buffer,
  ext: string,
  context: string,
): Promise<NormalizedStagedRaster> {
  let format: string | undefined
  try {
    format = (await sharp(buffer).metadata()).format
  } catch (err) {
    logger.warn(
      `[brand-extraction] staged asset sniff failed context=${context} ext=${ext} err=${ensureError(err).message}`,
    )
    return { buffer, ext }
  }
  const safeExt = format ? LLM_SAFE_FORMAT_EXTENSIONS[format] : undefined
  if (safeExt) {
    return { buffer, ext: safeExt }
  }
  try {
    const png = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      // Bake EXIF orientation into the pixels: the resize drops the metadata,
      // so a source that stored its rotation only in the Orientation tag would
      // otherwise reach the model sideways.
      .rotate()
      .resize({
        fit: 'inside',
        height: MAX_RASTER_DIMENSION,
        width: MAX_RASTER_DIMENSION,
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 6 })
      .toBuffer()
    logger.info(
      `[brand-extraction] transcoded staged asset to png context=${context} from=${format ?? 'unknown'} bytes=${buffer.length}->${png.length}`,
    )
    return { buffer: png, ext: 'png' }
  } catch (err) {
    logger.warn(
      `[brand-extraction] staged asset png transcode failed context=${context} from=${format ?? 'unknown'} err=${ensureError(err).message}`,
    )
    return { buffer, ext }
  }
}
