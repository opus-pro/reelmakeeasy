/**
 * Resolve the audio URL surfaced by the Story Mode audio pill and forwarded
 * to remix. Shared between the share page (`/share/[shareId]`) and the
 * project page (`/story-mode/:projectId`) so both surfaces classify a
 * project's input mode identically.
 *
 * Two cases:
 *
 * 1. `hasUploadedVideo` (legacy / fallback): the attachments API returned a
 *    `video/*` entry in `assets` but no `audioUrl`. This shouldn't happen
 *    for audio-mode projects -- the API now returns the video
 *    URL as `audioUrl` -- but it can still occur for pre-fix projects
 *    served from the DB fallback or for non-audio-mode projects whose
 *    user_uploaded/ folder somehow contains a video. In that case we fall
 *    back to the transcoded `voice_over.mp3` produced by finalize.
 *
 * 2. `uploadedAudioUrl` points into `/user_uploaded/`: trust the URL the
 *    API returns, regardless of extension. The browser's `<audio>` element
 *    decodes the audio track from `.mp4` / `.mov` / `.webm` containers.
 *    This is the path: pre-finalize audio-mode projects with a
 *    video source surface here.
 *
 * Returns undefined for TTS-only projects so the "Audio to Video" UI
 * stays off text-to-video projects.
 */
export function pickTemplateAudioUrl(params: {
  hasUploadedVideo?: boolean
  uploadedAudioUrl?: null | string
  voiceoverAudioUrl?: string
}): string | undefined {
  const uploadedUrl = params.uploadedAudioUrl
  if (uploadedUrl?.includes('/user_uploaded/')) {
    return uploadedUrl
  }
  // Legacy / fallback: BE didn't surface a user_uploaded audioUrl but the
  // assets list told us a video is present. Reach for the canonical
  // voice_over.mp3 (post-finalize only -- may 404 pre-finalize for projects
  // that don't go through the BE path).
  if (params.hasUploadedVideo && params.voiceoverAudioUrl) {
    return params.voiceoverAudioUrl
  }
  return undefined
}
