import {
  AudioTrack,
  CaptionTrack,
  MediaTrack,
  TemplateAssetTrack,
  VideoScript,
} from '@reelmakeeasy/common/types/video-script'
import { Setter } from 'jotai'

import { TemplateTrackDel } from '@/app/projects/[projectId]/editor/instances/template/track'
import { editorCoreStore } from '@/app/projects/[projectId]/editor/stores/editor-core.store'

export function syncVideoScriptToStore(set: Setter, videoScript: VideoScript): void {
  const templateTracks = videoScript.tracks.filter(
    (v): v is TemplateAssetTrack => v.type === 'template-asset',
  )
  const templateTrackInstance =
    templateTracks.length > 0 ? new TemplateTrackDel(templateTracks[0]) : undefined
  set(editorCoreStore.templateTrackInstance, templateTrackInstance)

  const audioTrack = videoScript.tracks.find((t): t is AudioTrack => t.type === 'audio')
  set(editorCoreStore.audioTrack, audioTrack)

  const hookTrack = videoScript.tracks.find(
    (t): t is MediaTrack => t.type === 'media' && t.id === 'track-hook',
  )
  set(editorCoreStore.hookTrack, hookTrack)

  const captionTrack = videoScript.tracks.find((t): t is CaptionTrack => t.type === 'caption')
  set(editorCoreStore.captionTrack, captionTrack)
}
