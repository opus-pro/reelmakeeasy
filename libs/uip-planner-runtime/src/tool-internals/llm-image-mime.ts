/**
 * Image formats the vision LLMs (OpenAI, Gemini) reject with HTTP 400.
 * Mirrors `LLM_INCOMPATIBLE_MIMES` / `LLM_INCOMPATIBLE_EXTS` in
 * `apps/services/api/src/util/rasterize-upload-for-llm.ts` -- the exact set
 * we rasterize to PNG at promote time. When that rasterization fails the raw
 * asset survives with its original MIME *and* original extension, so we
 * mirror both checks: a mislabeled upload (content_type `image/png`,
 * file_name `logo.svg`) is targeted for rasterize by extension and would
 * slip past a MIME-only guard. Any call site that inlines an uploaded image
 * into an LLM request must drop what this predicate rejects; otherwise the
 * one bad asset 400s and fails the whole planner turn. Kept as a literal
 * copy because `libs/` cannot import from `apps/`.
 */
const LLM_INCOMPATIBLE_IMAGE_MIMES = new Set([
  'image/avif',
  'image/heic',
  'image/heif',
  'image/svg',
  'image/svg+xml',
  'image/tiff',
])

const LLM_INCOMPATIBLE_IMAGE_EXTS = new Set(['.avif', '.heic', '.heif', '.svg', '.tif', '.tiff'])

/**
 * True when an uploaded asset is an image the vision LLMs can ingest
 * directly. Rejects non-image MIMEs, the known-incompatible raster formats
 * (by MIME or by file extension), and empty content types; any other
 * `image/*` (including unknown / degenerate types) is allowed through with
 * its original bytes, matching prior behavior.
 */
export function isLlmCompatibleImageAsset(asset: {
  contentType?: null | string
  fileName?: null | string
}): boolean {
  const mime = asset.contentType?.toLowerCase().trim()
  if (!mime || !mime.startsWith('image/') || LLM_INCOMPATIBLE_IMAGE_MIMES.has(mime)) {
    return false
  }
  return !LLM_INCOMPATIBLE_IMAGE_EXTS.has(getExtension(asset.fileName ?? ''))
}

function getExtension(name: string): string {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot === -1 ? '' : lower.slice(dot)
}
