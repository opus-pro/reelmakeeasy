// Must match media.controller.ts generateUploadUrl sanitize rule.
export const sanitizeUploadFileName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9._-]/g, '_')
