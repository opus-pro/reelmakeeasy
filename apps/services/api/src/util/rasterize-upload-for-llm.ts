// Vision LLMs (OpenAI, Gemini, etc.) reject these formats with HTTP 400
// "not a valid image". Rasterizing to PNG lets every downstream
// LLM-driven step (`describe_uploaded_images`,
// `analyzeLongTakeUserAssetUnderstanding`, anchor generation, ...) succeed
// without each call site needing to know about source format.
//
// Sharp is primary: fast, in-memory, covers SVG / TIFF / AVIF / WebP.
// Sharp's bundled `@img/sharp-libvips-linux-x64` builds libheif with
// `-DWITH_LIBDE265=0`, so HEVC-encoded HEIC (the iPhone default) raises
// `heif_suberror_No_matching_decoder_installed`. Fall back to the system
// ffmpeg in that case -- our container build has the HEVC decoder.
//
// PNG preserves alpha so logos with transparency aren't flattened to a
// background colour; JPEG would be smaller but lossy + alpha-stripping,
// which is the wrong tradeoff for reference assets.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import sharp from 'sharp'

import { getFfmpeg } from './ffmpeg'

const LLM_INCOMPATIBLE_MIMES = new Set([
  'image/avif',
  'image/heic',
  'image/heif',
  'image/svg',
  'image/svg+xml',
  'image/tiff',
])

const LLM_INCOMPATIBLE_EXTS = new Set(['.avif', '.heic', '.heif', '.svg', '.tif', '.tiff'])

// The set of source extensions the ffmpeg tempfile is allowed to carry.
// `fileName` reaches us from the upload request, so the extension is
// attacker-controlled; anything outside this set falls back to a generic
// `.bin` (ffmpeg still autodetects format from the bytes). The whitelist
// is intentionally narrower than `path.extname()` would accept -- we only
// admit formats sharp would have tried first.
const FFMPEG_ALLOWED_EXTS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpe',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
])

// Wall-clock cap for the ffmpeg child. iPhone HEICs decode in well under
// a second on the stg api node; SVGs / TIFFs are typically sub-second
// too. 30s leaves headroom for a multi-tile grid HEIF on a busy node
// while bounding the worst case -- the whole reason this PR exists is
// that an unbounded rasterize call inside `resolveUploadedAssetsForProject`'s
// `Promise.all` could pin a uip-create-session request forever, and
// fluent-ffmpeg has no built-in wall-clock timeout.
const FFMPEG_TIMEOUT_MS = 30_000

export type RasterizedAsset = {
  buffer: Buffer
  contentType: 'image/png'
  fileName: string
}

// Cap the rasterized PNG's long edge -- ample for any vision-LLM reference
// image and keeps the output payload small.
const MAX_RASTER_DIMENSION = 2048

// Base density for vector (SVG) rasterization: crisp at typical preview
// sizes. Clamped down per-source (see resolveRasterDensity) so a huge SVG
// never renders a giant canvas.
const BASE_SVG_DENSITY = 144

// Finite guard against decompression bombs from untrusted uploads -- a
// crafted `<svg width="50000" ...>` or a giant HEIC/TIFF must never render a
// multi-GB raster and OOM the worker. Generous enough for any real reference
// image; anything past it throws and the caller drops the asset.
const MAX_INPUT_PIXELS = 268_435_456 // 256 MP (~16384 x 16384)

export async function rasterizeForLlm(source: Buffer, fileName: string): Promise<RasterizedAsset> {
  try {
    return await rasterizeWithSharp(source, fileName)
  } catch (sharpError) {
    logger.warn(
      { err: ensureError(sharpError), fileName },
      'rasterizeForLlm: sharp failed; falling back to ffmpeg',
    )
    try {
      return await rasterizeWithFfmpeg(source, fileName)
    } catch (ffmpegError) {
      logger.warn(
        { err: ensureError(ffmpegError), fileName },
        'rasterizeForLlm: ffmpeg fallback also failed; rethrowing sharp error',
      )
      // Surface the sharp error so callers keep the same primary-decoder
      // diagnostic. The ffmpeg failure is in the warn line above.
      throw sharpError
    }
  }
}

export function shouldRasterizeForLlm(opts: {
  contentType?: null | string
  fileName?: null | string
}): boolean {
  const mime = opts.contentType?.toLowerCase().trim()
  if (mime && LLM_INCOMPATIBLE_MIMES.has(mime)) {
    return true
  }
  const ext = getExtension(opts.fileName ?? '')
  return ext !== '' && LLM_INCOMPATIBLE_EXTS.has(ext)
}

async function rasterizeWithSharp(source: Buffer, fileName: string): Promise<RasterizedAsset> {
  // .rotate() applies EXIF orientation for phone photos (HEIC). failOn:'none'
  // tolerates minor decoder warnings that some HEIC encoders emit. Density is
  // clamped per-source so an oversized SVG renders a bounded canvas; the input
  // pixel cap + output resize bound memory and payload for any source.
  const density = await resolveRasterDensity(source)
  const buffer = await sharp(source, {
    density,
    failOn: 'none',
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .rotate()
    .resize({
      fit: 'inside',
      height: MAX_RASTER_DIMENSION,
      width: MAX_RASTER_DIMENSION,
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 6 })
    .toBuffer()
  return {
    buffer,
    contentType: 'image/png',
    fileName: replaceExtension(fileName, '.png'),
  }
}

// Exported for tests. `options.timeoutMs` overrides the production default
// so the timeout path can be exercised in < 100ms instead of waiting on
// the real 30s deadline; production callers always take the default.
export async function rasterizeWithFfmpeg(
  source: Buffer,
  fileName: string,
  options: { timeoutMs?: number } = {},
): Promise<RasterizedAsset> {
  const timeoutMs = options.timeoutMs ?? FFMPEG_TIMEOUT_MS
  // `fileName` is user-controlled. Derive the tempfile extension from the
  // basename (so `'a/../b.heic'` -> `'.heic'`, never `'.heic/../passwd'`)
  // and validate it against the whitelist; anything else becomes `.bin`,
  // which keeps the input path strictly inside the `mkdtemp` directory.
  const candidateExt = path.extname(path.basename(fileName)).toLowerCase()
  const sourceExt = FFMPEG_ALLOWED_EXTS.has(candidateExt) ? candidateExt : '.bin'
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rasterize-llm-'))
  const inputPath = path.join(dir, `input${sourceExt}`)
  const outputPath = path.join(dir, 'output.png')
  try {
    await writeFile(inputPath, source)
    await new Promise<void>((resolve, reject) => {
      // Holder so the timer handle is reachable from the .on(...) handlers
      // registered before setTimeout runs, without needing a `let` ESLint
      // would (correctly) want declared at the assignment site.
      const state: { settled: boolean; timer?: NodeJS.Timeout } = { settled: false }
      const settle = (fn: () => void) => {
        if (state.settled) {
          return
        }
        state.settled = true
        if (state.timer) {
          clearTimeout(state.timer)
        }
        fn()
      }
      const command = getFfmpeg()
        .input(inputPath)
        // -frames:v 1: HEIC can carry multiple images (Live Photo aux
        //   tracks, depth maps, thumbnails); take the primary frame only.
        // -update 1: tell the image2 muxer the output path is a single
        //   file, not a `%d`-style sequence pattern.
        .outputOption('-frames:v', '1')
        .outputOption('-update', '1')
        .output(outputPath)
        .on('end', () =>
          settle(() => {
            resolve()
          }),
        )
        .on('error', (err, _stdout, stderr) =>
          settle(() => {
            reject(
              new Error(`ffmpeg rasterize failed: ${err?.message ?? String(err)}\n${stderr ?? ''}`),
            )
          }),
        )
      state.timer = setTimeout(() => {
        // SIGKILL forces the child to exit; fluent-ffmpeg fires `error`
        // with the signal, which the .on('error') above turns into a
        // rejection via `settle`. We also schedule a synchronous-reject
        // fallback in case fluent-ffmpeg never wires up the error event
        // (e.g. it died before .run() spawned the child).
        try {
          command.kill('SIGKILL')
        } catch {
          // fluent-ffmpeg may have already torn down -- ignore.
        }
        settle(() => {
          reject(new Error(`ffmpeg rasterize timed out after ${timeoutMs}ms`))
        })
      }, timeoutMs)
      command.run()
    })
    const buffer = await readFile(outputPath)
    if (buffer.length === 0) {
      throw new Error('ffmpeg rasterize produced an empty PNG')
    }
    return {
      buffer,
      contentType: 'image/png',
      fileName: replaceExtension(fileName, '.png'),
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup; a leftover tempdir is preferable to masking
      // the original error.
    })
  }
}

function getExtension(name: string): string {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot === -1 ? '' : lower.slice(dot)
}

function replaceExtension(name: string, ext: '.png'): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? `${name}${ext}` : `${name.slice(0, dot)}${ext}`
}

/**
 * For SVG sources, lower the render density so the rasterized canvas stays
 * near MAX_RASTER_DIMENSION on its long edge. This renders oversized SVGs at
 * a bounded resolution instead of either throwing on the pixel limit or
 * needing the input cap disabled (an OOM vector on untrusted input). The
 * output .resize() still guarantees the final dimension; this only keeps the
 * intermediate render small. Non-vector sources ignore density, so they get
 * BASE_SVG_DENSITY and lean on MAX_INPUT_PIXELS as the bomb guard.
 */
async function resolveRasterDensity(source: Buffer): Promise<number> {
  try {
    const meta = await sharp(source).metadata()
    if (meta.format !== 'svg' || !meta.width || !meta.height) {
      return BASE_SVG_DENSITY
    }
    const longEdge = Math.max(meta.width, meta.height)
    if (longEdge <= MAX_RASTER_DIMENSION) {
      return BASE_SVG_DENSITY
    }
    // metadata() reports SVG dims at the default 72 DPI, so scale density
    // down from that baseline to land the long edge near the cap.
    const fitted = Math.floor((MAX_RASTER_DIMENSION / longEdge) * 72)
    return Math.max(1, Math.min(BASE_SVG_DENSITY, fitted))
  } catch {
    return BASE_SVG_DENSITY
  }
}
