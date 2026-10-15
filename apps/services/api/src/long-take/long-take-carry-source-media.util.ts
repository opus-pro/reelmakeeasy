import { createSubLogger } from '@reelmakeeasy/common/logger'
import {
  copyStoredFile,
  keyIsUnder,
  projectRootKey,
  storeKeyOf,
  storeUri,
  toStoreUri,
} from '@reelmakeeasy/common/storage/stored-files'

const logger = createSubLogger('long-take-carry-source-media')

/**
 * A regenerate/restyle creates a NEW project seeded from a SOURCE
 * project. Fields that carried a source object BY REFERENCE left the derived
 * project holding `projects/{sourceProjectId}/...` URLs, so the derived project
 * depended on files in another project's folder.
 *
 * Copying the object into the derived project keeps every project's media under
 * its own `projects/{projectId}/` prefix, so each project stays self-contained.
 *
 * Same shape as the remix carry (`uip/uip-brand-remix-assets.ts`
 * `buildCarryDestUri`): the copy only ever writes into the derived project.
 */
export interface CarriedProjectObject {
  /**
   * The copy for fields the browser loads. Saved as its `store://` address like every
   * stored file: the served URL is built when the record is sent to a browser.
   */
  cdnUrl: string
  /** The copy as a `store://` address, for fields whose contract is a storage path. */
  fileUri: string
}

/**
 * Copy one object out of the SOURCE project's prefix into the DERIVED project's
 * matching path, and return both forms of the copy.
 *
 * Returns null -- meaning "nothing carried, keep what you had" -- for every
 * value that is not this environment's own copy of a source-project object:
 *
 *   a value that parses as neither a `store://` address nor a served URL;
 *   an object outside `projects/{sourceProjectId}/`, which covers the common case of a
 *   preset style thumbnail or a `custom-style/{userId}/` preview -- neither is
 *   the source project's to copy, and neither is project-scoped, so neither is
 *   what this counter is reporting;
 *   a path carrying a `..` traversal segment.
 *
 * The sub-path under the project id is preserved, so a content-addressed name
 * (`bgm/bed-{sha256}.mp3`) keeps meaning what it says -- the copy is the same
 * bytes under the same name, one project over.
 *
 * Throws only what `copyStoredFile` throws. Callers decide whether a failed carry
 * is fatal; both current callers fall back to the source reference, which still
 * resolves for a server-side `store://` read and is strictly better than dropping
 * the field.
 */
export async function carrySourceProjectObject(
  storedValue: null | string | undefined,
  sourceProjectId: string,
  newProjectId: string,
): Promise<CarriedProjectObject | null> {
  const destUri = resolveCarryDestUri(storedValue, sourceProjectId, newProjectId)
  if (!destUri) {
    return null
  }
  await copyStoredFile(destUri.sourceUri, destUri.uri)
  logger.info(`[${newProjectId}] carried ${destUri.sourceUri} to ${destUri.uri}`)
  return { cdnUrl: destUri.uri, fileUri: destUri.uri }
}

/**
 * The pure half: decide whether a stored value names a source-project object and,
 * if so, where its copy belongs. Exported for the unit tests, which must be able
 * to assert the path arithmetic and the rejections without touching storage.
 */
export function resolveCarryDestUri(
  storedValue: null | string | undefined,
  sourceProjectId: string,
  newProjectId: string,
): null | { sourceUri: string; uri: string } {
  if (!storedValue || !sourceProjectId || !newProjectId || sourceProjectId === newProjectId) {
    return null
  }
  let sourceUri: string | undefined
  try {
    // Normalizes a CDN URL, a legacy host and a `store://` URI into one canonical
    // form, so a caller can hand this either of the two fields it stores.
    sourceUri = toStoreUri(storedValue)
  } catch {
    return null
  }
  if (!sourceUri) {
    return null
  }

  // The parser decodes once and refuses `..`, hidden and empty segments, so a key
  // that passes cannot climb out of the source project's folder.
  const key = storeKeyOf(sourceUri)
  const sourcePrefix = projectRootKey(sourceProjectId)
  if (!key || !keyIsUnder(key, sourcePrefix)) {
    return null
  }

  // Built from the checked key: `storeUri` escapes a literal `%`, so the new address
  // decodes to exactly this key and the copy lands where the row says.
  return {
    sourceUri,
    uri: storeUri(`${projectRootKey(newProjectId)}${key.slice(sourcePrefix.length)}`),
  }
}
