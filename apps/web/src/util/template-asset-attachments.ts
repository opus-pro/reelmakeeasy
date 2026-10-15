import type { Attachment } from '@shared/types/assets/attachment'

/**
 * Minimal shape shared by quick-start assets, shared-project assets, and demo
 * project assets. Keeping this local avoids dragging a public type re-export
 * through `@shared/types`.
 */
export type TemplateAsset = {
  mimeType: string
  name: string
  url: string
}

/**
 * Convert template / shared-project / quick-start assets into Attachments with
 * path-safe ids.
 *
 * The id flows through to `assetId` in the UIP session-create RPC and is used
 * as a store path segment by `uip-uploaded-assets.ts`. Earlier code set
 * `id: asset.url`, which produced malformed objects like
 * `uploads/https://cdn.../filename`. The generated id matches the
 * `upload_<ts>_<i>` shape that the API multipart-upload path already uses, so
 * both entry points to the same destination path builder emit consistent ids.
 *
 * The caller is responsible for filtering assets by mimeType before calling
 * this. Some surfaces drop `video/*` as voice-overs, while others keep them as
 * visual references.
 */
export function templateAssetsToAttachments(assets: TemplateAsset[]): Attachment[] {
  const baseTs = Date.now()
  return assets.map((asset, index) => ({
    id: `upload_${baseTs}_${index}`,
    md5: '',
    name: asset.name,
    size: 0,
    type: asset.mimeType,
    url: asset.url,
  }))
}
