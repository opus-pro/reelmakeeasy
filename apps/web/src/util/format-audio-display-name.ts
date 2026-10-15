export function formatAudioDisplayName(url: string): string {
  const filename = url.split('/').pop() || 'audio'
  const withoutTimestamp = filename.replace(/^\d+-/, '')
  const displayName = `User Uploaded-${withoutTimestamp}`
  const maxLen = 30
  if (displayName.length <= maxLen) {
    return displayName
  }
  const extIndex = displayName.lastIndexOf('.')
  const ext = extIndex === -1 ? '' : displayName.slice(extIndex)
  const nameWithoutExt = extIndex === -1 ? displayName : displayName.slice(0, extIndex)
  const availableLen = maxLen - ext.length - 3
  const truncatedName = nameWithoutExt.slice(0, Math.max(availableLen, 1))
  return `${truncatedName}...${ext}`
}
