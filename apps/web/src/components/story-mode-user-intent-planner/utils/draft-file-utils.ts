import type { AssetRef } from '../state-types'

export function mapDraftFileType(contentType: string): AssetRef['type'] {
  if (contentType.startsWith('image/')) {
    return 'img'
  }
  if (contentType.startsWith('video/')) {
    return 'video'
  }
  if (contentType.startsWith('audio/')) {
    return 'audio'
  }
  if (contentType === 'application/pdf') {
    return 'pdf'
  }
  if (contentType.startsWith('text/')) {
    return 'txt'
  }
  return 'file'
}
