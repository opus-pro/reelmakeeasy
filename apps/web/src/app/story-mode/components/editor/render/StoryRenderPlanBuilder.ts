import { resolveCaptionLook } from '@reelmakeeasy/common/adapters/caption/caption-look'
import type { CaptionRenderPref } from '@reelmakeeasy/common/adapters/caption/caption-style'
import { transcriptToEditingScriptTextTrack } from '@reelmakeeasy/common/adapters/caption/caption-to-editing-script-text-track'
import {
  factStampLabelOnStrip,
  type FactStampStripImage,
  factStampStripImage,
  factStampStripSeg,
} from '@reelmakeeasy/common/adapters/caption/fact-stamps'
import { TextAdapter } from '@reelmakeeasy/common/adapters/text-adapter'
import { BGM_DEFAULT_VOLUME } from '@reelmakeeasy/common/long-take/bgm-volume'
import { getDeliveryCanvasSize } from '@reelmakeeasy/common/long-take/render-frame-area'
import type {
  AudioSeg,
  CaptionSeg,
  RenderPlan,
  Seg,
  Track,
  VideoSeg,
} from '@reelmakeeasy/common/types/render-plan-struct'
import { AssetType, SegType, TrackType } from '@reelmakeeasy/common/types/render-plan-struct'
import type { CaptionTrack, FactsTrack, VideoScript } from '@reelmakeeasy/common/types/video-script'
import type { TranscriptData } from '@shared/types/agent/transcript'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'

import type { StorySegment, StoryTransitionSegment } from '@/app/story-mode/long-take.types'
import { captionAspectRatio, type CaptionKind } from '@/components/captions/caption-settings'

// The editor engine's font bundle ships in the preset pack (see next.config.js).
const DEFAULT_FONT_GZIP_PATH = `${process.env.NEXT_PUBLIC_PRESET_PACK_URL}/editor/storymode_fonts.tar.gz`
// The export's fonts, from the same pack, which the editor's own bundle (Montserrat only) lacks:
// a loop's fact stamps are set in its PT Serif Bold, and a caption font chosen from it (Anton,
// PT Serif...) loads from here too. One URL for every pack face on the page.
const RENDER_FONT_GZIP_PATH = `${process.env.NEXT_PUBLIC_PRESET_PACK_URL}/render/fonts.tar.gz`

interface BuildParams {
  aspectRatio: string
  bgmUrl?: null | string
  bgmVolume?: null | number
  captionEnabled?: boolean
  /** Which default caption look applies when nothing is chosen (loops start in Punch). */
  captionKind?: CaptionKind
  /** The caption look the user is choosing (saved, or ahead of the save); null: the kind's default. */
  captionStyle?: CaptionStyleSettings | null
  /**
   * Whether a loop's fact stamps may be drawn: false while the look they take their colour from
   * is still being read, so they don't show in the default highlight first. Default true.
   */
  factsReady?: boolean
  /**
   * Makes a fact stamp's strip image (factStampStripUrl in the page): the engine draws each strip
   * from one, square, as the export does. Without it, or for a strip it can't make, the label
   * keeps the engine's own (rounded, wider) box.
   */
  factStripUrl?: (image: FactStampStripImage) => Promise<string | undefined>
  /**
   * A loop short's clips joined back to back (`long_take/beat_loop_clips.mp4`), the picture
   * its delivered file is made from: played as one muted segment over the whole loop, in
   * place of the clips one by one. Their sound plays beside the engine (the clip sound bed).
   */
  loopClipsUrl?: null | string
  musicEnabled?: boolean
  segments: StorySegment[]
  totalMs: number
  transcript?: TranscriptData
  videoScript?: VideoScript
  voiceOverUrl?: null | string
}

/**
 * Pure-functional builder: converts LongTake domain data into a RenderPlan
 * consumable by the AVEditorEngine WASM renderer.
 */
export class StoryRenderPlanBuilder {
  static async build({
    aspectRatio,
    bgmUrl,
    bgmVolume,
    captionEnabled,
    captionKind = 'video',
    captionStyle,
    factsReady = true,
    factStripUrl,
    loopClipsUrl,
    musicEnabled,
    segments,
    totalMs,
    transcript,
    videoScript,
    voiceOverUrl,
  }: BuildParams): Promise<RenderPlan> {
    const { width, height } = StoryRenderPlanBuilder.parseAspectRatio(aspectRatio)
    const tracks: Track<Seg>[] = [
      loopClipsUrl
        ? StoryRenderPlanBuilder.buildLoopClipsTrack(loopClipsUrl, totalMs)
        : StoryRenderPlanBuilder.buildVideoTrack(segments, { width, height }),
    ]

    if (voiceOverUrl) {
      tracks.push(StoryRenderPlanBuilder.buildAudioTrack(voiceOverUrl, totalMs))
    }

    if (bgmUrl && musicEnabled) {
      tracks.push(
        StoryRenderPlanBuilder.buildBgmTrack(bgmUrl, totalMs, bgmVolume ?? BGM_DEFAULT_VOLUME),
      )
    }

    // The look comes from the live settings, not the pref frozen into the video script at
    // the last render, so a style change shows here before the video renders again. Resolved
    // as the render resolves it (a loop laid out for 9:16 whatever its row says).
    const { captionRenderPref: renderPref } = resolveCaptionLook(captionStyle, {
      aspectRatio: captionAspectRatio(aspectRatio),
      kind: captionKind,
    })

    if (captionEnabled) {
      tracks.push(
        ...(await StoryRenderPlanBuilder.buildCaptionTracks({
          captionKind,
          renderPref,
          transcript,
          videoScript,
        })),
      )
    }

    // A loop's fact stamps, over the captions, in the look's highlight colour: drawn with the
    // captions off too (facts, not captions), once that look is read.
    if (factsReady) {
      tracks.push(
        ...(await StoryRenderPlanBuilder.buildFactStampTracks({
          factStripUrl,
          frame: { height, width },
          renderPref,
          videoScript,
        })),
      )
    }

    return {
      id: '#Root',
      tracks,
      defaultFontGzipPath: DEFAULT_FONT_GZIP_PATH,
      videoInfo: { id: '#VideoInfo', width, height, frameRate: '25' },
      audioInfo: { id: '#AudioInfo', sampleRate: 48000, channels: 2 },
    }
  }

  /**
   * The preview's frame (the plan's and the canvas's size): the delivered file's. The engine
   * rounds caption font sizes and line widths to its canvas, so at any other size some
   * captions would wrap, shrink or box differently from the download.
   */
  static parseAspectRatio(ratio: string): { height: number; width: number } {
    const parts = ratio.replace(/\s/g, '').split('/')
    const w = Number.parseInt(parts[0], 10) || 9
    const h = Number.parseInt(parts[1], 10) || 16

    if (w === 16 && h === 9) {
      return getDeliveryCanvasSize('16:9')
    }
    if (w === 1 && h === 1) {
      return getDeliveryCanvasSize('1:1')
    }
    return getDeliveryCanvasSize('9:16')
  }

  private static buildAudioTrack(audioUrl: string, totalMs: number): Track<AudioSeg> {
    return {
      id: '#AudioTrack',
      type: TrackType.Audio,
      segs: [
        {
          id: 'seg-voiceover',
          type: SegType.Audio,
          assetType: AssetType.Audio,
          in: 0,
          out: totalMs,
          uri: audioUrl,
          trimStart: 0,
          trimEnd: totalMs,
          volume: 100,
        },
      ],
    }
  }

  // Background-music bed mixed under the voiceover by the engine.
  // The generated bed is length-matched to the video server-side, so a single
  // segment covering [0, totalMs] suffices; mirrors buildAudioTrack, which
  // does not clamp trimEnd to the asset duration either. Volume uses the
  // engine's 0-100 scale and comes from the music panel slider.
  private static buildBgmTrack(bgmUrl: string, totalMs: number, volume: number): Track<AudioSeg> {
    return {
      id: '#BgmTrack',
      type: TrackType.Audio,
      segs: [
        {
          id: 'seg-bgm',
          type: SegType.Audio,
          assetType: AssetType.Audio,
          in: 0,
          out: totalMs,
          uri: bgmUrl,
          trimStart: 0,
          trimEnd: totalMs,
          volume,
        },
      ],
    }
  }

  // The caption layers, bottom first (Explainer's paper strip under its words): the same
  // layers the export draws.
  private static async buildCaptionTracks({
    captionKind,
    renderPref,
    transcript,
    videoScript,
  }: {
    captionKind: CaptionKind
    renderPref: CaptionRenderPref
    transcript?: TranscriptData
    videoScript?: VideoScript
  }): Promise<Track<CaptionSeg>[]> {
    const captionTrackFromVs = videoScript?.tracks.find(
      (track): track is CaptionTrack => track.type === 'caption',
    )

    // Prefer the caption track the last render wrote (post first export). Otherwise build it
    // from the transcript (pre-export preview, or the render wrote no caption track).
    if (captionTrackFromVs) {
      return await TextAdapter.genCaptionTextTracks({
        fontGzipPath: RENDER_FONT_GZIP_PATH,
        renderPref,
        track: captionTrackFromVs,
      })
    }

    if (transcript) {
      // A loop's chunks each stay up until the next one; older loop transcripts lack the flag.
      const source: TranscriptData =
        captionKind === 'loop' ? { ...transcript, captionWindows: 'segment' } : transcript
      return await TextAdapter.genCaptionTextTracks({
        fontGzipPath: RENDER_FONT_GZIP_PATH,
        renderPref,
        track: transcriptToEditingScriptTextTrack(source),
      })
    }

    return []
  }

  // A loop's fact stamps as its export draws them, from the facts track its last render saved.
  // A loop not rendered since stamps became a track has none here (its file still has them);
  // its next render adds them. A loop without stamps saves an empty track: nothing to draw.
  // Each strip is an image layer under its label (the engine has no square box), the label then
  // without its own box; a label whose strip image can't be made keeps it.
  private static async buildFactStampTracks({
    factStripUrl,
    frame,
    renderPref,
    videoScript,
  }: {
    factStripUrl?: BuildParams['factStripUrl']
    frame: { height: number; width: number }
    renderPref: CaptionRenderPref
    videoScript?: VideoScript
  }): Promise<Track<Seg>[]> {
    const facts = videoScript?.tracks.find((track): track is FactsTrack => track.type === 'facts')
    if (!facts?.segments.length) {
      return []
    }
    const labels = TextAdapter.genFactStampTrack({
      fontGzipPath: RENDER_FONT_GZIP_PATH,
      frame,
      renderPref,
      track: facts,
    })
    const urls = factStripUrl
      ? await Promise.all(
          labels.segs.map((seg) =>
            factStripUrl(factStampStripImage(seg)).catch((): undefined => undefined),
          ),
        )
      : []
    const strips: VideoSeg[] = []
    const segs = labels.segs.map((seg, i) => {
      const url = urls[i]
      if (!url) {
        return seg
      }
      strips.push(factStampStripSeg(seg, url, frame))
      return factStampLabelOnStrip(seg)
    })
    const stamps: Track<CaptionSeg> = { ...labels, segs }
    if (!strips.length) {
      return [stamps]
    }
    return [{ id: '#FactStripTrack', segs: strips, type: TrackType.Video }, stamps]
  }

  // A loop's joined clips, already cut to the grid and cover-scaled to its 9:16 frame by its
  // render: one segment over the whole loop, muted like every clip here.
  private static buildLoopClipsTrack(clipsUrl: string, totalMs: number): Track<VideoSeg> {
    return {
      id: 'track-video',
      type: TrackType.Video,
      segs: [
        {
          id: 'v-loop-clips',
          type: SegType.Video,
          assetType: AssetType.Video,
          uri: clipsUrl,
          in: 0,
          out: totalMs,
          trimStart: 0,
          trimEnd: totalMs,
          cropPosition: [{ ft: 0, mode: 0, v: [0, 0] }],
          cropSize: [{ ft: 0, mode: 0, v: [1, 1] }],
          loop: 0,
          volume: 0,
        },
      ],
    }
  }

  private static buildVideoTrack(
    segments: StorySegment[],
    canvas: { height: number; width: number },
  ): Track<VideoSeg> {
    const segs: VideoSeg[] = segments
      .filter((s): s is StoryTransitionSegment => s.kind === 'transition')
      .map((segment) => {
        const { cropPos, cropSz } = StoryRenderPlanBuilder.computeCoverCrop(segment, canvas)
        return {
          id: `v-trans-${segment.transitionId}`,
          type: SegType.Video,
          assetType: AssetType.Video,
          uri: segment.videoUri,
          in: segment.startMs,
          out: segment.endMs,
          trimStart: 0,
          trimEnd: segment.endMs - segment.startMs,
          cropPosition: [{ ft: 0, mode: 0, v: cropPos }],
          cropSize: [{ ft: 0, mode: 0, v: cropSz }],
          loop: 0,
          volume: 0,
        }
      })

    return {
      id: 'track-video',
      type: TrackType.Video,
      segs,
    }
  }

  // Center-crop the clip to fill the canvas without bars.
  // Falls back to full-frame when clip dims are unknown.
  private static computeCoverCrop(
    segment: StoryTransitionSegment,
    canvas: { height: number; width: number },
  ): { cropPos: [number, number]; cropSz: [number, number] } {
    const { videoWidth: cw, videoHeight: ch } = segment
    const FULL: [number, number] = [1, 1]
    const ORIGIN: [number, number] = [0, 0]

    if (!cw || !ch) {
      return { cropPos: ORIGIN, cropSz: FULL }
    }

    const clipAR = cw / ch
    const canvasAR = canvas.width / canvas.height
    const delta = Math.abs(clipAR - canvasAR) / canvasAR

    if (delta < 0.001) {
      return { cropPos: ORIGIN, cropSz: FULL }
    }

    if (clipAR > canvasAR) {
      // clip wider than canvas: trim left/right
      const wPct = canvasAR / clipAR
      return { cropPos: [(1 - wPct) / 2, 0], cropSz: [wPct, 1] }
    }

    // clip taller than canvas: trim top/bottom
    const hPct = clipAR / canvasAR
    return { cropPos: [0, (1 - hPct) / 2], cropSz: [1, hPct] }
  }
}
