/**
 * Whether a storage read failed because the object isn't there: the local store's "No such
 * object" (code 404, as storage answers), or a missing file. Anything else (a file cut short, bad
 * JSON, a disk error) is not "missing", and a caller that treats a missing record as empty
 * must not treat those as empty too.
 */
export function isMissingObjectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return (
    code === 404 ||
    code === '404' ||
    code === 'ENOENT' ||
    (typeof message === 'string' && message.startsWith('No such object'))
  )
}
