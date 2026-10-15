/**
 * Sanitize a user-supplied filename for safe use as a stored file key:
 * replace any character outside [A-Za-z0-9._-] with an underscore.
 * Case is preserved.
 */
export function sanitizeUploadFileName(fileName: string): string {
  return (fileName || '').replace(/[^a-zA-Z0-9._-]/g, '_')
}
