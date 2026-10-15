import { VIDEO_NOT_RENDERED_ERROR_CODE } from '@reelmakeeasy/common/long-take/video-not-rendered'
import { isStoreUri, storedFileKey, storeKeyOf } from '@reelmakeeasy/common/storage/address'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'
import { NotFoundException } from '@nestjs/common'

/**
 * The key of the stored file an address or a served URL names, decoded once; null for
 * anything that isn't ours.
 */
function storageKeyOfFileUrl(value: string): null | string {
  return (isStoreUri(value) ? storeKeyOf(value) : storedFileKey(value)) ?? null
}

async function storedObjectExists(key: string): Promise<boolean> {
  return fileStore.file(key).exists()
}

/**
 * Whether the stored file a download address or URL points at is there. A signed link to a missing
 * file only fails in the browser (a 404 the user downloads), so `download-url` checks
 * first and answers 404 itself (`videoNotRendered`); the client then renders.
 *
 * False only when storage says the object is missing: a URL that isn't ours, or a
 * storage error, counts as present (the download goes ahead as before). The key is
 * decoded exactly once, so a `%` in a stored name doesn't read as missing.
 */
export async function downloadFileExists(
  url: string,
  exists: (key: string) => Promise<boolean> = storedObjectExists,
): Promise<boolean> {
  try {
    const key = storageKeyOfFileUrl(url)
    if (key === null) {
      return true
    }
    return await exists(key)
  } catch {
    return true
  }
}

/** The 404 for a project whose delivered file is missing, with the code clients match. */
export function videoNotRendered(): NotFoundException {
  return new NotFoundException({
    code: VIDEO_NOT_RENDERED_ERROR_CODE,
    message: 'The video has not been rendered yet',
    statusCode: 404,
  })
}
