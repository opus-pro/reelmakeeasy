/**
 * Shared helpers for the UIP service.
 *
 * Split out of `uip.service.ts` to keep the service file within the
 * 800-line max-lines lint budget. CreateSession-side helpers that point the
 * upload tags in the initial message at the uploads' new addresses once they are
 * copied into the project's folder. The message is saved with addresses only (no
 * host or port); the API serves them as URLs when the timeline is sent out.
 */

import { addressForText } from '@reelmakeeasy/common/storage/address'
import {
  isStoreUri,
  projectRootKey,
  storedFileUrl,
  storeKeyOf,
  storeUri,
} from '@reelmakeeasy/common/storage/stored-files'

/**
 * Record every form a moved upload may take in the message (its temp path, its
 * `store://` address and its served URL), each mapped to its new address in the form it
 * takes inside text, so text naming any of them is rewritten in one pass.
 */
export function recordUrlMapping(
  urlMap: Map<string, string>,
  oldPathOrUri: string,
  newUri: string,
): void {
  const newAddress = addressForText(newUri)
  const oldUri = isStoreUri(oldPathOrUri) ? oldPathOrUri : storeUri(oldPathOrUri)
  for (const old of new Set([oldPathOrUri, oldUri, storedFileUrl(oldUri)])) {
    if (old) urlMap.set(old, newAddress)
  }
}

/**
 * Replace any occurrence of a temp asset URL in `message` with its new URL.
 * Iterates longest-key-first so prefix URLs don't shadow longer matches.
 */
export function rewriteMessageAssetUrls(
  message: string | undefined,
  urlMap: Map<string, string>,
): string | undefined {
  if (!message || urlMap.size === 0) {
    return message
  }
  let rewritten = message
  const keys = [...urlMap.keys()].sort((a, b) => b.length - a.length)
  for (const oldUrl of keys) {
    const newUrl = urlMap.get(oldUrl)
    if (!newUrl || oldUrl === newUrl) {
      continue
    }
    rewritten = rewritten.split(oldUrl).join(newUrl)
  }
  return rewritten
}

const META_TAG_PATTERN = /@(vo|img|video|audio|txt|pdf|file)\[([^\]]*)\]\(([^)|]+)(?:\|[^)]*)?\)/g

/**
 * Point the `@type[label](asset_id|<preview>)` tags at each upload's address, by
 * asset id. Covers the previews a string match can't, most importantly the client-only
 * `blob:` URLs of the upload preview.
 */
export function rewriteMessageAssetIdsToAddresses(
  message: string | undefined,
  resolvedAssets: Array<{ asset_id: string; file_name: string; file_path: string }> | undefined,
  projectId: string,
): string | undefined {
  if (!message || !resolvedAssets?.length) {
    return message
  }
  const addressByAssetId = new Map<string, string>()
  for (const asset of resolvedAssets) {
    const address = uploadedAssetAddress(projectId, asset.file_path)
    if (address) {
      addressByAssetId.set(asset.asset_id, address)
    }
  }
  if (addressByAssetId.size === 0) {
    return message
  }
  return message.replace(META_TAG_PATTERN, (full, type, label, resId) => {
    const address = addressByAssetId.get(resId)
    return address ? `@${type}[${label}](${resId}|${address})` : full
  })
}

/** Where an uploaded asset's tag points: its address (in text form), or an external URL as is. */
function uploadedAssetAddress(projectId: string, filePath: string): null | string {
  if (!filePath) {
    return null
  }
  // External URLs are kept as they are.
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath
  }
  // An absolute store:// address from the upload fallback; a malformed one is left as is.
  if (isStoreUri(filePath)) {
    return storeKeyOf(filePath) ? addressForText(filePath) : filePath
  }
  // A path relative to the project's planner folder.
  return addressForText(storeUri(`${projectRootKey(projectId)}/user-intent-planner/${filePath}`))
}
