import { RenderTemplate } from '@reelmakeeasy/common/template/type'
import { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import {
  AudioTrack,
  CaptionTrack,
  MediaTrack,
  VideoScript,
} from '@reelmakeeasy/common/types/video-script'
import { Shot } from '@shared/types/api'
import { atom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { isEqual } from 'lodash-es'

import { sceneListAtom } from '@/atom/project'

import { type TemplateTrackDel } from '../instances/template/track'
import { renderMainEngineStore } from '../render-engine-sdk/render-main-engine.store'
import { selectorWithForceUpdate } from '../utils/selector-with-force-update'

import { editorUiStore } from './editor-ui.store'

const templateTrackInstance = atom<TemplateTrackDel | undefined>(undefined)
templateTrackInstance.debugLabel = 'editor.core.templateTrackInstance'

const templateTrack = selectorWithForceUpdate(templateTrackInstance, (t) => t?.parse())
templateTrack.debugLabel = 'editor.core.templateTrack'

const templateList = atom<RenderTemplate[] | undefined>(undefined)
templateList.debugLabel = 'editor.core.templateList'

const audioTrack = atom<AudioTrack | undefined>(undefined)
audioTrack.debugLabel = 'editor.core.audioTrack'

const hookTrack = atom<MediaTrack | undefined>(undefined)
hookTrack.debugLabel = 'editor.core.hookTrack'

const captionTrack = atom<CaptionTrack | undefined>(undefined)
captionTrack.debugLabel = 'editor.core.captionTrack'

const videoScript = selectAtom(
  atom((get) => {
    const template = get(templateTrack)
    const audio = get(audioTrack)
    const hook = get(hookTrack)
    const caption = get(captionTrack)

    const tracks: VideoScript['tracks'] = []
    if (template) {
      tracks.push(template)
    }
    if (audio) {
      tracks.push(audio)
    }
    if (hook) {
      tracks.push(hook)
    }
    if (caption) {
      tracks.push(caption)
    }

    return {
      tracks,
    } as VideoScript
  }),
  (t) => t,
  isEqual,
)
videoScript.debugLabel = 'editor.core.videoScript'

const renderPlan = atom<RenderPlan | undefined>(undefined)
renderPlan.debugLabel = 'editor.core.renderPlan'

export const currentShotAtom = selectAtom(
  atom((get) => {
    // currentTime is in milliseconds, convert to seconds
    const currentTimeMs = get(renderMainEngineStore.currentTime)
    const currentTime = currentTimeMs / 1000 // convert to seconds
    const sceneList = get(sceneListAtom)
    const selectedShotId = get(editorUiStore.selectedShotId)
    return { currentTime, sceneList, selectedShotId }
  }),
  ({ currentTime, sceneList, selectedShotId }): null | Shot => {
    if (!sceneList || sceneList.length === 0 || currentTime == null || currentTime < 0) {
      return null
    }

    if (selectedShotId) {
      for (const scene of sceneList) {
        const shot = scene.shots?.find((item) => item.id === selectedShotId)
        if (shot) {
          return { ...shot, sceneId: scene.id }
        }
      }
    }

    const epsilon = 0.08
    // Find the shot that matches the current time
    // Shots have timeRange with start and end in seconds
    for (const scene of sceneList) {
      if (!scene.shots || scene.shots.length === 0) {
        continue
      }

      for (const shot of scene.shots) {
        const { timeRange } = shot
        if (timeRange && currentTime >= timeRange.start && currentTime < timeRange.end + epsilon) {
          return { ...shot, sceneId: scene.id }
        }
      }
    }

    return null
  },
  (a, b) => {
    // Only update if the shot actually changed (by id)
    if (a === null && b === null) {
      return true
    }
    if (a === null || b === null) {
      return false
    }
    return a.id === b.id
  },
)
currentShotAtom.debugLabel = 'editor.core.currentShot'

const currentSegments = selectAtom(
  atom((get) => {
    const instance = get(templateTrackInstance)
    const templateTrackSnapshot = get(templateTrack)
    const currentShot = get(currentShotAtom)
    if (!currentShot?.timeRange || !instance || !templateTrackSnapshot) {
      return []
    }

    const startMs = currentShot.timeRange.start * 1000
    const endMs = currentShot.timeRange.end * 1000
    const segments = instance.findSegmentsByTimeRange(startMs, endMs)
    if (!segments || segments.length === 0) {
      return []
    }

    return segments.filter(
      (seg) =>
        seg.content.params.background?.uri ||
        seg.content.params.images?.length ||
        seg.content.params.texts?.length,
    )
  }),
  (t) => t,
  (a, b) => a === b,
)
currentSegments.debugLabel = 'editor.core.currentSegments'

export const editorCoreStore = {
  audioTrack,
  captionTrack,
  currentShot: currentShotAtom,
  currentSegments,
  hookTrack,
  renderPlan,
  templateList,
  templateTrack,
  templateTrackInstance,
  videoScript,
}
