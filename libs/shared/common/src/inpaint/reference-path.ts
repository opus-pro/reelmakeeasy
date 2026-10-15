import { keyIsUnder, storeKeyOf } from '../storage/address'

// A reference is a client-supplied store address that the editor reads on the server,
// so it is confined to the temp-upload folder that issued it (media.controller.ts
// generate-temp-upload-url). Without this any stored file -- another project's assets,
// a user's voice clones -- would be readable by naming it.
export const INPAINT_REFERENCE_PREFIX = 'tmp'

// Upload scope for inpaint references. Split out from the shared
// `story-mode-images` scope so this one prefix can require a verified identity
// without changing omni-chat, brand or keyframe-edit uploads, which all share
// that scope.
export const INPAINT_REFERENCE_SCOPE = 'inpaint-references'

/** The folder (a key) a project's promoted references live in. */
export function inpaintDurableReferencePrefix(projectId: string): string {
  return `projects/${projectId}/inpaint/references`
}

/**
 * Path-safe and INJECTIVE encoding of the owner id.
 *
 * The blanket `[^a-zA-Z0-9._-] -> _` used elsewhere is lossy: `auth0|a_b` and
 * `auth0|a@b` collapse onto one segment, and since ownership is decided by
 * folder that would let either subject claim the other's uploads. Escaping to
 * `~<hex>` keeps distinct subjects distinct. No hashing, so this stays usable
 * from any runtime that imports this module.
 */
export function sanitizeReferenceOwnerId(ownerId: string): string {
  return String(ownerId).replace(/[^a-zA-Z0-9._-]/g, (char) => {
    const hex = char.codePointAt(0)?.toString(16).padStart(2, '0') ?? '00'
    return `~${hex}`
  })
}

// The only temp folder (a key) a caller may name for a NEW reference: their own.
export function inpaintOwnedReferencePrefix(ownerId: string): string {
  return `${INPAINT_REFERENCE_PREFIX}/${sanitizeReferenceOwnerId(ownerId)}/${INPAINT_REFERENCE_SCOPE}`
}

/**
 * The checked key of a reference address. The one parser decodes once and refuses
 * `..`, hidden and empty segments and leftover escapes, so the key is what is read.
 */
function referenceKey(fileUri: unknown): string | undefined {
  return typeof fileUri === 'string' ? storeKeyOf(fileUri) : undefined
}

/**
 * Containment only: is this path somewhere the editor is allowed to read from.
 *
 * Deliberately identity-free, because both callers need it but only one has a
 * caller: the controller runs on a request, while the editor activity
 * re-validates persisted state on every replay and has no identity to check
 * against. Ownership is asserted separately, at the controller, via
 * `isOwnedScopeReferencePath` + `inpaintOwnedReferencePrefix`.
 */
export function isAllowedInpaintReferencePath(fileUri: unknown, projectId: string): boolean {
  const key = referenceKey(fileUri)
  if (!key) {
    return false
  }
  if (keyIsUnder(key, INPAINT_REFERENCE_PREFIX)) {
    return true
  }
  // projectId is a URL path param; a value containing '/' would widen the durable
  // folder beyond the one project it is supposed to scope, so the durable branch is
  // disabled for anything but a clean, non-empty projectId.
  if (typeof projectId !== 'string' || projectId === '' || projectId.includes('/')) {
    return false
  }
  return keyIsUnder(key, inpaintDurableReferencePrefix(projectId))
}

// True for a temp-folder reference that predates the owned scope. Counted so the
// contract phase can be scheduled on evidence: when this stops firing, the legacy
// branch above can be deleted.
export function isLegacyInpaintReferencePath(fileUri: unknown): boolean {
  const key = referenceKey(fileUri)
  return (
    !!key &&
    keyIsUnder(key, INPAINT_REFERENCE_PREFIX) &&
    !key.split('/').includes(INPAINT_REFERENCE_SCOPE)
  )
}

// Is this path claiming the owned upload scope. The controller pairs this with
// `inpaintOwnedReferencePrefix` to require that the claim matches the caller.
export function isOwnedScopeReferencePath(fileUri: unknown): boolean {
  const key = referenceKey(fileUri)
  return (
    !!key &&
    keyIsUnder(key, INPAINT_REFERENCE_PREFIX) &&
    key.split('/').includes(INPAINT_REFERENCE_SCOPE)
  )
}

/**
 * Does this owned-scope path belong to `ownerId`. Compares the checked key, matching
 * `isAllowedInpaintReferencePath` and `isOwnedScopeReferencePath`, so a percent-encoded
 * address that containment accepts is judged by the file it names.
 */
export function ownsInpaintReferencePath(fileUri: unknown, ownerId: string): boolean {
  const key = referenceKey(fileUri)
  return !!key && keyIsUnder(key, inpaintOwnedReferencePrefix(ownerId))
}
