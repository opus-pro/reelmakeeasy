import { PUBLIC_CDN_BASE_URL } from '../storage/public-assets'
import { Images, RenderTemplate } from '../template/type'
import { CanvasSize } from '../types'
import { RenderPlan } from '../types/render-plan-struct'
import { VideoScript } from '../types/video-script'

import type { CaptionRenderPref } from './caption/caption-style'
import { getDefaultCaptionRenderPref } from './caption/default-caption-render-pref'
import { CaptionAnimationName } from './caption/render.zod'
import { AudioAdapter } from './audio-adapter'
import { GetTemplateAssetPath, TemplateAssetAdapter } from './template-adapter'
import { TextAdapter } from './text-adapter'
import { TransitionAdapter } from './transition-adapter'
import { getBaseId, toBoolean } from './utils'
import { VideoAdapter } from './video-adapter'

type Input = {
  /** The caption style, with its preset extras (short chunks, Explainer's strip) when it has them. */
  captionRenderPref?: CaptionRenderPref
  forcedHideCaptionBg?: boolean
  getAllTemplatesSpec: () => Promise<RenderTemplate[]>
  getFallbackFontPath: () => Promise<string>
  getFilePath: (url: string, subDir?: string) => Promise<string>
  getMediaMetadata: (
    image: Images<string>['images'][number],
  ) => Promise<{ height: number; width: number }>
  getTemplateAssetPath: GetTemplateAssetPath
  getVideoFps: () => string
  outputSize: CanvasSize
  rootDir: string
  usePreview?: boolean
  videoScript: VideoScript
}

export class VideoScriptAdapter {
  static async genRenderPlan(input: Input): Promise<RenderPlan | undefined> {
    // find tracks have text elements, on when we should hide caption track
    const { timelines: timelinesHaveText } = TextAdapter.findNonCaptionTextTracks(
      input.videoScript.tracks,
    )

    const tracks = (
      await Promise.all(
        input.videoScript.tracks.map(async (track) => {
          if (track.type === 'media') {
            return VideoAdapter.genMediaTrack({
              getFilePath: input.getFilePath,
              track,
              usePreview: input.usePreview ?? false,
            })
          }
          if (track.type === 'template-asset') {
            const { bgTrack, effectTrack, lastEffectTrack, templateAssetTracks } =
              await TemplateAssetAdapter.genAssetTrack({
                getFilePath: input.getFilePath,
                getTemplateAssetPath: input.getTemplateAssetPath,
                getMediaMetadata: input.getMediaMetadata,
                getFallbackFontPath: input.getFallbackFontPath,
                getAllTemplatesSpec: input.getAllTemplatesSpec,
                track,
                usePreview: input.usePreview ?? false,
              })
            return [bgTrack, effectTrack, ...templateAssetTracks, lastEffectTrack]
          }
          if (track.type === 'audio') {
            return AudioAdapter.genAudioTrack({
              getFilePath: input.getFilePath,
              track,
              usePreview: input.usePreview ?? false,
            })
          }
          if (track.type === 'caption') {
            const renderPref: CaptionRenderPref =
              input.captionRenderPref || getDefaultCaptionRenderPref()
            if (renderPref.enableCaption !== true) {
              return []
            }

            // caption that has bg, should turn off the cover layer (Explainer's strip is one)
            const noBgNames: CaptionAnimationName[] = ['', 'deep-diver', 'simple-words-pop']
            const needBgLayer = input.forcedHideCaptionBg
              ? false
              : !renderPref.strip && !noBgNames.includes(renderPref.captionAnimation?.name ?? '')

            // The caption on top, Explainer's strip under it (part of the caption itself, so
            // forcedHideCaptionBg keeps it): the same layers the editor preview draws.
            const captionLayers = await TextAdapter.genCaptionTextTracks({
              track,
              renderPref,
              noCaptionTimeline: timelinesHaveText,
            })
            const captionTrack = captionLayers.at(-1)
            const captionBgTrack =
              needBgLayer && captionTrack
                ? await TextAdapter.genCaptionBgTrack(captionTrack, input.getFilePath)
                : undefined
            // bg should go first, which goes under the caption layers
            return [captionBgTrack, ...captionLayers].filter(toBoolean)
          }
          if (track.type === 'facts') {
            // A loop's fact stamps, in the caption style's highlight colour: drawn with the
            // captions off too (facts, not captions). A loop without stamps saves an empty one.
            if (!track.segments.length) {
              return []
            }
            return TextAdapter.genFactStampTrack({
              frame: input.outputSize,
              renderPref: input.captionRenderPref || getDefaultCaptionRenderPref(),
              track,
            })
          }
          if (track.type === 'transition') {
            return TransitionAdapter.genTransitionTrack({
              getFilePath: input.getFilePath,
              track,
            })
          }

          return undefined
        }),
      )
    )
      .flat()
      .filter(toBoolean) as RenderPlan['tracks']

    // reorder track segs for fix black screen issue
    tracks.forEach((track) => {
      if (track && 'segs' in track) {
        track.segs = track.segs.toSorted((a, b) => a.in - b.in)
      }
    })

    return {
      audioInfo: VideoScriptAdapter.getAudioInfo(),
      id: getBaseId('Root'),
      rootDir: input.rootDir,
      defaultFontGzipPath: `${PUBLIC_CDN_BASE_URL}/ae-template/lottie/base-fonts/fonts.tar.gz`,
      tracks,
      videoInfo: await VideoScriptAdapter.getVideoInfo(input.outputSize, input.getVideoFps),
    }
  }

  static getAudioInfo(): { channels: number; id: string; sampleRate: number } {
    return {
      channels: 2,
      id: getBaseId('AudioInfo'),
      sampleRate: 48000,
    }
  }

  static async getVideoInfo(
    outputSize: CanvasSize,
    getFps: Input['getVideoFps'],
  ): Promise<{ frameRate: string; height: number; id: string; width: number }> {
    return {
      frameRate: getFps(),
      height: outputSize.height,
      id: getBaseId('VideoInfo'),
      width: outputSize.width,
    }
  }
}
