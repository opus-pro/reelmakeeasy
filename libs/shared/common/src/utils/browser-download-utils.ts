/**
 * Sanitize a string for use as a filename.
 */
export function sanitizeFilename(name: string): string {
  const sanitized = name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  // if sanitized is empty, return 'video'
  return sanitized || 'video'
}

/**
 * Trigger a browser download from a given URL.
 * Creates a temporary anchor element and clicks it.
 */
export function triggerDownloadFromUrl(url: string, filename?: string) {
  const a = document.createElement('a')
  a.href = url
  // Detached so a non-attachment error response opens in a throwaway tab
  // instead of replacing the app tab; attachment responses download as usual.
  a.target = '_blank'
  a.rel = 'noopener'
  if (filename) {
    a.download = filename
  }
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/**
 * Trigger a browser download from a Blob.
 * Handles creating an object URL and cleaning it up after use.
 */
export function triggerDownloadFromBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  // Clean up the object URL to prevent memory leaks
  // Small delay to ensure the download has started in some browsers
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 100)
}
