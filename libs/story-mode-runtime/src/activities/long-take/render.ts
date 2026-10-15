import { getWatermarkEnableFlag } from '@agent-lib/agents/common/utils'
import { generateWatermarkSegments } from '@agent-lib/agents/video-script/utils/add-watermark-track'
import {
  type CaptionLook,
  resolveCaptionLook,
} from '@reelmakeeasy/common/adapters/caption/caption-look'
import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { readBeatLoopRenderSpec } from '@reelmakeeasy/common/long-take/beat-loop-delivery'
import { renderBeatLoopFinal } from '@reelmakeeasy/common/long-take/beat-loop-render'
import { BGM_DEFAULT_VOLUME } from '@reelmakeeasy/common/long-take/bgm-volume'
import { renderFinal, type RenderFinalResult } from '@reelmakeeasy/common/long-take/render-final'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import type { MediaTrack, VideoScript } from '@reelmakeeasy/common/types/video-script'
import { getMediaDurationMs } from '@reelmakeeasy/common/utils/media'
import { getProjectDataService } from '@shared/db-access-layer'

import type {
  RenderLongTakeVideoActivityParams,
  RenderLongTakeVideoActivityResult,
} from '../../workflows/long-take/types'

import {
  getFirstLongTakeKeyframeThumbnailUrl,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage } from './storage'

export async function renderLongTakeVideo(
  params: RenderLongTakeVideoActivityParams,
): Promise<RenderLongTakeVideoActivityResult> {
  const {
    aspectRatio,
    bgmBedUri,
    bgmVolume,
    enableCaption,
    keyframesToCommit,
    projectId,
    transitionVideos,
    userEmail,
    userId,
  } = params
  return withLongTakeContext({ projectId, userId, userEmail }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      const audioSourceUri = storage.getFullPath(STORY_LOADER_PATHS.audioVoiceoverPath)
      const getThumbnailFallback = () => getFirstLongTakeKeyframeThumbnailUrl(storage, projectId)
      const userContext = { userEmail: userEmail || '', userId }

      // A loop short (long_take/beat_loop.json): every render of it, the first one, render_video,
      // the caption toggle and editor export, goes through the beat-loop render. Its clips'
      // sound effects are its soundtrack; music the user added goes under them in its finish
      // pass (never the story bake, which would mix it into the clips' sound).
      const beatLoop = await readBeatLoopRenderSpec(storage)
      // The video's caption look, resolved once: either render draws its captions in it and
      // saves it, with the settings it came from, in the video script.
      const { captionRenderPref, captionStyle } = await resolveRenderCaptionLook(params, {
        aspectRatio,
        isLoop: Boolean(beatLoop),
      })
      if (beatLoop) {
        const music = bgmBedUri
          ? { bedUri: bgmBedUri, volume: bgmVolume ?? BGM_DEFAULT_VOLUME }
          : undefined
        return toActivityResult(
          await renderBeatLoopFinal({
            aspectRatio,
            audioSourceUri,
            beatLoop,
            captionRenderPref,
            captionStyle,
            enableCaption,
            getThumbnailFallback,
            keyframesToCommit,
            logger,
            ...(music ? { music } : {}),
            projectId,
            storage,
            transitionVideos,
            userContext,
          }),
        )
      }

      // Measure the actual voiceover audio duration so the audio track is
      // never clipped short by transition timing.
      const audioDurationMs = await getMediaDurationMs(audioSourceUri)

      const enableWatermark = getWatermarkEnableFlag(userId, userEmail || '')

      // The watermark copy is the clean script plus the watermark track: the same captions in the
      // same look (a script without its pref would render in the default look).
      const buildWatermarkVideoScript = enableWatermark
        ? (cleanScript: VideoScript, totalDurationMs: number): VideoScript => {
            const watermarkTrack: MediaTrack = {
              id: 'track-watermark',
              type: 'media',
              segments: generateWatermarkSegments(totalDurationMs),
            }
            return {
              ...cleanScript,
              tracks: [...cleanScript.tracks, watermarkTrack],
            }
          }
        : undefined

      const result = await renderFinal({
        aspectRatio,
        audioDurationMs,
        audioSourceUri,
        bgmBedUri,
        // The music's Volume % the user saved (a render again: render_video, the editor's
        // export), baked at the remux's level; none handed (the first render): the default.
        ...(bgmVolume === undefined ? {} : { bgmVolume }),
        buildWatermarkVideoScript,
        captionRenderPref,
        captionStyle,
        enableCaption,
        getThumbnailFallback,
        keyframesToCommit,
        logger,
        projectId,
        storage,
        transitionVideos,
        userContext,
      })

      return toActivityResult(result)
    }),
  )
}

/**
 * The caption look a render draws: the one the render request carries (an editor export: what
 * the user was looking at, null meaning the default), else the one saved on the project. Loops
 * start in Punch and every other video in Classic when nobody chose one, laid out for the frame
 * (a loop is always 9:16). Every render, the first one, agent re-renders and editor exports,
 * resolves it here, so the look is read in one place.
 */
async function resolveRenderCaptionLook(
  params: Pick<RenderLongTakeVideoActivityParams, 'captionStyle' | 'projectId'>,
  opts: { aspectRatio?: AspectRatio; isLoop: boolean },
): Promise<CaptionLook> {
  const settings =
    params.captionStyle === undefined
      ? (await getProjectDataService().getProject(params.projectId))?.captionStyle
      : params.captionStyle
  // A loop is laid out for 9:16 whatever its row says (captionLayoutRatio).
  return resolveCaptionLook(settings, {
    aspectRatio: opts.aspectRatio ?? '9:16',
    kind: opts.isLoop ? 'loop' : 'video',
  })
}

function toActivityResult(result: RenderFinalResult): RenderLongTakeVideoActivityResult {
  return {
    bgmBaked: result.bgmBaked,
    enableCaption: result.enableCaption,
    renderDurationMs: result.renderDurationMs,
    thumbnailFallbackUsed: result.thumbnailFallbackUsed,
    videoUri: result.videoUri,
  }
}
