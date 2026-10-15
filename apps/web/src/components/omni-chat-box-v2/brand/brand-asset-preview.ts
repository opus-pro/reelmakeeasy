/**
 * What to render a brand asset FROM, as opposed to what to identify it by.
 *
 * `staging_uri` is the asset's stored identity and the key every write path
 * matches on -- the uris echoed back in `stagedAssets` / `removeAssets` on
 * `PUT /brand-briefs/:id`, and in `brand_brief_excluded_asset_uris` on session
 * create. `viewable_url` is an optional fetchable URL beside it; when it is
 * absent (the normal case), the preview renders from `staging_uri`.
 *
 * Keeping the two apart is the point: putting a display URL where an identity
 * is expected makes the server delete the asset (`applyStagedAssetsLayout`) or
 * silently re-add a removed one (`dropExcludedAssets`).
 *
 * Structurally typed and import-free on purpose, so a consumer (and its tests)
 * can import it without pulling in `brand-briefs-client.ts` at runtime.
 */
export function assetPreviewUri(asset: {
  staging_uri: string
  viewable_url?: null | string
}): string {
  return asset.viewable_url ?? asset.staging_uri
}
