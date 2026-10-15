/**
 * Content-type / URL -> file-extension guessers for the brand-extraction
 * crawler. Header-derived extension is preferred (servers send authoritative
 * MIME); URL pattern is the fallback for CDN URLs that drop the header.
 */

export function guessExtension(url: string, contentType: string | undefined): null | string {
  // Prefer the Content-Type header; fall back to URL suffix.
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('avif')) {
    return 'avif'
  }
  if (ct.includes('png')) {
    return 'png'
  }
  if (ct.includes('jpeg') || ct.includes('jpg')) {
    return 'jpg'
  }
  if (ct.includes('webp')) {
    return 'webp'
  }
  if (ct.includes('gif')) {
    return 'gif'
  }
  if (ct.includes('svg')) {
    return 'svg'
  }
  if (ct.includes('bmp')) {
    return 'bmp'
  }
  if (ct.includes('tiff') || ct.includes('tif')) {
    return 'tiff'
  }
  if (ct.includes('icon')) {
    return 'ico'
  }
  const m = /\.(avif|png|jpe?g|webp|gif|svg|bmp|tiff?|ico)(\?|#|$)/i.exec(url)
  if (m) {
    const ext = m[1].toLowerCase()
    if (ext === 'jpeg') {
      return 'jpg'
    }
    if (ext === 'tif') {
      return 'tiff'
    }
    return ext
  }
  return null
}

export function guessFontExtension(url: string, contentType: string | undefined): null | string {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('woff2')) {
    return 'woff2'
  }
  if (ct.includes('woff')) {
    return 'woff'
  }
  if (ct.includes('ttf') || ct.includes('truetype')) {
    return 'ttf'
  }
  if (ct.includes('otf') || ct.includes('opentype')) {
    return 'otf'
  }
  const m = /\.(woff2|woff|ttf|otf)(\?|#|$)/i.exec(url)
  if (m) {
    return m[1].toLowerCase()
  }
  return null
}

/**
 * Magic-byte check that a buffer is actually a decodable raster image
 * (PNG / JPEG / GIF / WebP / BMP / TIFF / ICO / AVIF).
 *
 * guessExtension trusts the URL suffix, so a non-image body served at an image
 * URL -- e.g. an HTML soft-404 page returned for `/logo.png` -- is otherwise
 * staged as a `.png`. The claimed `image/png` then clears the downstream
 * multimodal MIME filter, and the real HTML bytes crash the single multimodal
 * storyboard request with a provider "failed to decode image data".
 * SVG is text-based and validated by rasterization elsewhere, so it is
 * intentionally not accepted here.
 */
export function isDecodableRasterImage(buffer: Buffer): boolean {
  const startsWith = (offset: number, ...sig: number[]): boolean =>
    buffer.length >= offset + sig.length && sig.every((byte, i) => buffer[offset + i] === byte)
  return (
    startsWith(0, 0x89, 0x50, 0x4e, 0x47) || // PNG
    startsWith(0, 0xff, 0xd8, 0xff) || // JPEG
    startsWith(0, 0x47, 0x49, 0x46, 0x38) || // GIF8
    startsWith(0, 0x42, 0x4d) || // BMP "BM"
    startsWith(0, 0x49, 0x49, 0x2a, 0x00) || // TIFF little-endian
    startsWith(0, 0x4d, 0x4d, 0x00, 0x2a) || // TIFF big-endian
    startsWith(0, 0x00, 0x00, 0x01, 0x00) || // ICO
    (startsWith(0, 0x52, 0x49, 0x46, 0x46) && startsWith(8, 0x57, 0x45, 0x42, 0x50)) || // RIFF....WEBP
    // ISO-BMFF "ftyp" box (offset 4) with an AVIF brand at offset 8. Kept in
    // sync with guessExtension, which maps AVIF but not HEIF (heic/mif1); a
    // staged HEIF would drift to a `.bin` extension, so it is not accepted.
    (startsWith(4, 0x66, 0x74, 0x79, 0x70) &&
      ['avif', 'avis'].includes(buffer.toString('ascii', 8, 12)))
  )
}
