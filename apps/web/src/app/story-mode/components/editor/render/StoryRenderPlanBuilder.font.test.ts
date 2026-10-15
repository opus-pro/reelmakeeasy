/**
 * @jest-environment node
 */
// The builder is pure; under jsdom, nanoid (the caption ids) resolves to its ESM browser build.
import { transcriptToEditingScriptTextTrack } from '@reelmakeeasy/common/adapters/caption/caption-to-editing-script-text-track'
import { getDefaultCaptionRenderPref } from '@reelmakeeasy/common/adapters/caption/default-caption-render-pref'
import type { CaptionSeg, RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import type { VideoScript } from '@reelmakeeasy/common/types/video-script'
import type { TranscriptData } from '@shared/types/agent/transcript'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'

import { StoryRenderPlanBuilder } from './StoryRenderPlanBuilder'

const transcript: TranscriptData = {
  language: 'en',
  segments: [
    {
      end: 2,
      start: 0,
      text: 'honey never spoils',
      words: [
        { end: 0.4, start: 0, word: 'honey' },
        { end: 0.9, start: 0.5, word: 'never' },
        { end: 1.6, start: 1, word: 'spoils' },
      ],
    },
  ],
}

// The one render font pack archive every pack face in the editor loads (the stamps use it too).
const RENDER_FONTS = `${process.env.NEXT_PUBLIC_PRESET_PACK_URL}/render/fonts.tar.gz`

async function captionSegs(
  captionStyle: CaptionStyleSettings | null,
  videoScript?: VideoScript,
): Promise<CaptionSeg[]> {
  const plan: RenderPlan = await StoryRenderPlanBuilder.build({
    aspectRatio: '9 / 16',
    captionEnabled: true,
    captionKind: 'video',
    captionStyle,
    segments: [],
    totalMs: 2000,
    transcript,
    videoScript,
  })
  return plan.tracks.filter((t) => t.segs[0]?.type === 't').flatMap((t) => t.segs) as CaptionSeg[]
}

describe('StoryRenderPlanBuilder and the caption font', () => {
  it('previews a chosen pack font from the render font pack', async () => {
    const segs = await captionSegs({ font: { family: 'Anton', source: 'pack' } })
    expect(segs.length).toBeGreaterThan(0)
    for (const seg of segs) {
      expect(seg.style.fontGzipPath).toBe(RENDER_FONTS)
      expect(seg.style.fontFamily).toBe('Anton, Montserrat')
    }
  })

  it('gives every Explainer layer the same font', async () => {
    const segs = await captionSegs({
      font: { family: 'PT Serif', source: 'pack' },
      preset: 'explainer',
    })
    expect(segs.length).toBeGreaterThan(1)
    expect(new Set(segs.map((s) => s.style.fontGzipPath))).toEqual(new Set([RENDER_FONTS]))
    expect(new Set(segs.map((s) => s.style.fontFamily))).toEqual(new Set(['PT Serif, Montserrat']))
  })

  it("uses the chosen font after a render too (the video script's caption track)", async () => {
    const videoScript = {
      captionRenderPref: getDefaultCaptionRenderPref(),
      tracks: [transcriptToEditingScriptTextTrack(transcript)],
    } as VideoScript
    const [seg] = await captionSegs({ font: { family: 'Roboto', source: 'pack' } }, videoScript)
    expect(seg.style.fontGzipPath).toBe(RENDER_FONTS)
    expect(seg.style.fontFamily).toBe('Roboto, Montserrat')
  })

  it("leaves the style's own font exactly as before", async () => {
    for (const style of [null, { font: null }] as const) {
      const [seg] = await captionSegs(style)
      expect(seg.style.fontGzipPath).toBeUndefined()
      expect(seg.style.fontFamily).not.toContain(',')
    }
  })
})
