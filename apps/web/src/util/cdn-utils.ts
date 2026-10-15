// Client-side file URL utilities (browser-safe, no server dependencies)
import { PUBLIC_CDN_BASE_URL } from '@reelmakeeasy/common/storage/public-assets'

export function encodeCdnUrlName(cdnUrl: string): string {
  // encode the file name in the cdn url
  const fileName = cdnUrl.split('/').pop()
  if (!fileName) {
    return cdnUrl
  }
  return cdnUrl.replace(fileName, encodeURIComponent(fileName))
}

export function getProjectV2CdnUrl(
  cdnOrigin: string,
  projectId: string,
  ...args: string[]
): string {
  return `${cdnOrigin}/projects/${projectId}/${args.join('/')}`
}

/** URL of a shared read-only asset (icons, animations, images) in the web app's public folder. */
export function getPublicCdnUrl(path: string): string {
  return `${PUBLIC_CDN_BASE_URL}/${path}`
}

export function getShotThumbnailUrl(
  cdnOrigin: string,
  projectId: string,
  sceneId: string,
  shotId: string,
): string {
  return getProjectV2CdnUrl(
    cdnOrigin,
    projectId,
    'storyboard',
    sceneId,
    shotId,
    'shot_preview_image.png',
  )
}

/**
 * @deprecated Do not add callers. The project read now returns this
 * as `ProjectForBackend.voiceoverAudioUrl`, derived server-side; the
 * two live consumers (the Story Mode viewer and remix) were migrated to it.
 *
 * What is left are the two template cards, which hold a `template.projectId` and
 * no project row to read the field from, so they compose the URL here.
 */
export function getWorkspaceAudioUrl(cdnOrigin: string, projectId: string): string {
  // Story Mode writes voice_over.mp3 through agent-v2 storage whose project
  // root is `projects/{projectId}`, not the legacy `agent/workspace/{projectId}`.
  return getProjectV2CdnUrl(cdnOrigin, projectId, 'story_loader', 'audio', 'voice_over.mp3')
}

export const getHookThumbnailUrl = (cdnOrigin: string, projectId: string) => {
  return getProjectV2CdnUrl(cdnOrigin, projectId, 'hook-video', 'hook-video_hook_video.mp4.jpg')
}

export const getHookPreviewVideoUrl = (cdnOrigin: string, projectId: string) => {
  return getProjectV2CdnUrl(cdnOrigin, projectId, 'hook-video', 'hook_video-preview.mp4')
}
