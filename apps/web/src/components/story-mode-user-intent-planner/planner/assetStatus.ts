import type { AssetRef, AssetStatus } from '../state-types'

export type NonReadyAssetStatus = Exclude<AssetStatus, 'ready'>

export const NON_READY_ASSET_LABEL: Record<NonReadyAssetStatus, string> = {
  failed: 'Failed',
  generating: 'Generating',
  planned: 'Queued',
}

/** How many of this pool came back failed -- what the Assets surfaces report and offer a retry on. */
export function countFailedAssets(assets: AssetRef[]): number {
  return assets.filter((asset) => asset.status === 'failed').length
}

export function isAssetReady(asset: AssetRef): boolean {
  return nonReadyAssetStatus(asset) === null
}

/**
 * The reason an asset has no image to show, or null when it does. `status` is only set
 * on generated anchor assets, so an absent one means the asset was never generated in the first
 * place -- an upload -- and is displayable as-is. Returning the narrowed union lets callers index
 * their own per-status maps without a cast.
 */
export function nonReadyAssetStatus(asset: AssetRef): NonReadyAssetStatus | null {
  const { status } = asset
  return status === undefined || status === 'ready' ? null : status
}
