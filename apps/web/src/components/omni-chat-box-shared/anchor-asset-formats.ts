// Shared source of truth for which image formats the Story Mode anchor-asset
// picker accepts. Imported by AnchorAssetsBox (v1 + v2) and AddAssetsDialog so
// that the file-input `accept` attribute and the drop/paste MIME guard agree.
//
// Server-side normalization in `apps/services/api/src/util/create-thumbnail`
// rasterizes SVG / HEIC / AVIF / TIFF to JPEG via sharp before downstream
// agents consume them, so anything listed here must either be a raster the
// API already handles or one sharp can rasterize.

const SUPPORTED_MIME_TYPES = [
  'image/avif',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/svg+xml',
  'image/tiff',
  'image/webp',
] as const

// Extension fallback for the MIME check: browsers/OSes often surface HEIC,
// HEIF, TIFF, and AVIF files with `File.type === ''` or
// `application/octet-stream`, which would otherwise be wrongly rejected by a
// pure MIME-set check.
const SUPPORTED_EXTENSIONS = [
  '.avif',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
] as const

export const STORY_MODE_SUPPORTED_MIME_TYPES: ReadonlySet<string> = new Set(SUPPORTED_MIME_TYPES)

// `accept=` accepts both MIME types and dot-extensions; combining the two
// gives the browser the best chance to surface every supported file.
export const STORY_MODE_IMAGE_ACCEPT = [...SUPPORTED_MIME_TYPES, ...SUPPORTED_EXTENSIONS].join(',')

export const STORY_MODE_SUPPORTED_FORMATS_LABEL =
  'PNG, JPG, WebP, GIF, SVG, HEIC/HEIF, TIFF, or AVIF'

const SUPPORTED_EXTENSIONS_SET: ReadonlySet<string> = new Set(SUPPORTED_EXTENSIONS)

const EXTENSION_TO_MIME: ReadonlyMap<string, string> = new Map([
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
  ['.webp', 'image/webp'],
])

export function isSupportedStoryModeImage(file: File): boolean {
  if (file.type && STORY_MODE_SUPPORTED_MIME_TYPES.has(file.type)) {
    return true
  }
  if (!hasMissingOrGenericMime(file)) {
    return false
  }
  const ext = getExtension(file.name)
  return ext !== '' && SUPPORTED_EXTENSIONS_SET.has(ext)
}

// Browsers don't always set `File.type` (HEIC, HEIF, and sometimes SVG/TIFF on
// drag-drop or older Safari). The signed-URL endpoint validates `contentType`
// is non-empty and storage requires the PUT `Content-Type` header to match the
// value the URL was signed with, so we need a real MIME string at upload time.
// Re-wrap the File with an inferred type only when the browser left it blank
// or generic; never override a real (even if unsupported) MIME.
export function normalizeStoryModeImageFile(file: File): File {
  if (file.type && STORY_MODE_SUPPORTED_MIME_TYPES.has(file.type)) {
    return file
  }
  if (!hasMissingOrGenericMime(file)) {
    return file
  }
  const inferred = EXTENSION_TO_MIME.get(getExtension(file.name))
  if (!inferred) {
    return file
  }
  return new File([file], file.name, { type: inferred, lastModified: file.lastModified })
}

function getExtension(name: string): string {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot === -1 ? '' : lower.slice(dot)
}

// A `text/plain` file renamed to `.jpg` should still be rejected.
// Extension-based acceptance only kicks in when the browser truly didn't
// classify the file (empty or generic octet-stream MIME).
function hasMissingOrGenericMime(file: File): boolean {
  const t = file.type.toLowerCase()
  return t === '' || t === 'application/octet-stream' || t === 'binary/octet-stream'
}
