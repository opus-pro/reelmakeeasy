import { isStoreKey, isStoreUri, storeKeyOf, storeUri } from '@reelmakeeasy/common/storage/address'
import { BadRequestException } from '@nestjs/common'

/**
 * The `store://` address of an uploaded file that a client names back to the API, as
 * `store://<key>` or a bare key.
 *
 * Anything else is refused. A stored file lives at `<data dir>/files/<key>`, so a key
 * with a `..` or hidden segment (also when encoded) would point outside the stored
 * files, at files such as the URL signing key, and the upload routes would copy that
 * file into a project. Checked by the one parser, on the decoded form, because that is
 * what storage reads.
 */
export function resolveUploadedFileUri(fileUri: string): string {
  if (isStoreUri(fileUri)) {
    if (!storeKeyOf(fileUri)) throw new BadRequestException('Invalid file path')
    return fileUri
  }
  if (!isStoreKey(fileUri)) throw new BadRequestException('Invalid file path')
  return storeUri(fileUri)
}
