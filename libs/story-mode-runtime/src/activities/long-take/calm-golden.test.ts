import { createHash } from 'node:crypto'

import {
  hailuoGenerationSeconds,
  retimeMaxSpeedFor,
} from '@reelmakeeasy/common/long-take/camera-craft'
import { buildLongTakeBeatSheetExpertPrompt } from '@reelmakeeasy/common/long-take/prompts/long-take-beat-sheet-expert-prompt'
import { buildLongTakeVisualScriptPrompt } from '@reelmakeeasy/common/long-take/prompts/long-take-visual-script-prompt'
import {
  buildLongTakeWorldBibleEnrichedExpertPrompt,
  buildLongTakeWorldBibleExpertPrompt,
} from '@reelmakeeasy/common/long-take/prompts/long-take-world-bible-expert-prompt'
import { RETIME_MAX_SPEED_MULTIPLIER } from '@reelmakeeasy/common/utils/retime-constants'
import { videoModelCapabilities } from '@reelmakeeasy/common/video-models/registry'
import { snapDuration } from '@reelmakeeasy/llm/registry'

import { buildLongTakeKeyframePromptsFromVisualScriptPrompt } from '../prompts/long-take-keyframe-prompts-from-visual-script-prompt'

import {
  fallbackHailuoTransitionPrompt,
  hailuoRewriteRequest,
  type HailuoRewriteInput,
} from './hailuo-transition-prompt'
import { buildLongTakeKeyframePrompt } from './storage'

/**
 * Calm, byte for byte. Every prompt below is pinned in `__snapshots__/calm-golden.test.ts.snap`,
 * written from the code before the Dynamic rework: a change to Calm fails here. Only rewrite
 * the snapshots (`jest -u`) for a change Calm is meant to get. The clip prompt is pinned as
 * text; the long planning prompts as their SHA-256 and length, so the file stays small.
 */

const digest = (text: string) =>
  `${createHash('sha256').update(text).digest('hex')} (${text.length} chars)`

const ROUTES = [undefined, 'general', 'abstract', 'ads-tangible', 'ads-intangible'] as const
const CALM = [undefined, 'calm'] as const

const visualScriptJson = JSON.stringify([
  {
    audio: 'In 1905 a patent clerk rewrote physics.',
    shot_id: '1',
    used_asset_id: ['char_einstein'],
    visual: {
      core_description: 'char_einstein writes at a cluttered desk in the Bern patent office.',
      entry_action: null,
      exit_action: 'The camera pushes in on the manuscript.',
    },
  },
  {
    audio: 'Light could behave like particles.',
    shot_id: '2',
    used_asset_id: [],
    visual: {
      core_description: 'A beam of light breaks into bright packets over a dark lab bench.',
      entry_action: 'The packets scatter across the bench.',
      exit_action: null,
    },
  },
])

const visualScriptInput = {
  assetManifest: {
    asset_manifest: [{ asset_id: 'char_einstein', keyword: 'Einstein', proper_name: 'Einstein' }],
  } as never,
  beatSheet: {
    beat_sheet: [
      { beat_id: 1, duration: 3.1, segment_text: 'In 1905 a patent clerk rewrote physics.' },
      { beat_id: 2, duration: 2.4, segment_text: 'Light could behave like particles.' },
    ],
  } as never,
  globalConstraints: { tone: 'curious', topic: 'Einstein 1905' },
  script: 'In 1905 a patent clerk rewrote physics. Light could behave like particles.',
  userAssetContent: {
    characters: [],
    files: [],
    mandatory_user_upload_bindings: [],
    objects: [],
  } as never,
  worldBible: {
    visual_strategy: { evolution_arc: 'Desk -> discovery -> legacy' },
  } as never,
}

const hailuoInput: HailuoRewriteInput = {
  beatBoundarySeconds: 2.9,
  clipIndex: 3,
  durationSeconds: 6.22,
  fromMotion: 'The camera pushes in on the manuscript.',
  fromScene: 'Einstein writes at a cluttered desk.',
  narration: 'In 1905 a patent clerk rewrote physics. Light could behave like particles.',
  projectId: '10121312-mmi',
  styleText: 'Halftone print collage',
  toMotion: 'The packets scatter across the bench.',
  toScene: 'A beam of light breaks into bright packets.',
  visualScript: 'Transition objective: create one continuous cinematic bridge.',
}

describe('Calm stays byte for byte', () => {
  it('writes the same Hailuo 3 clip request, cleaner and fallback', () => {
    const answer =
      '"[0:00.000-0:02.490] HIEROGLYPHIC QUEENS\nThe camera pushes in as the queens slide apart.\n\n[Shot 2] At 00:02.490 Ramesses slides in."'
    const pinned = (cameraStyle: 'calm' | null | undefined) => {
      const request = hailuoRewriteRequest({ ...hailuoInput, cameraStyle })
      return {
        cleaned: request.clean(answer),
        models: request.models,
        prompt: request.prompt,
        task: request.task,
        temperature: request.temperature,
      }
    }
    expect(pinned(undefined)).toEqual(pinned('calm'))
    expect(pinned(null)).toEqual(pinned('calm'))
    expect(pinned('calm')).toMatchSnapshot()
    expect(fallbackHailuoTransitionPrompt(hailuoInput)).toMatchSnapshot()
  })

  it('plans with the same beat sheet prompt on every route', () => {
    const pinned: Record<string, string> = {}
    for (const promptRoute of ROUTES) {
      const [unset, calm] = CALM.map((cameraStyle) =>
        buildLongTakeBeatSheetExpertPrompt({
          cameraStyle,
          promptRoute,
          timestampedTranscript: 'In(0.4s) 1905(1.0s) a(1.1s) patent(1.5s) clerk(1.9s)',
        }),
      )
      expect(calm).toBe(unset)
      pinned[promptRoute ?? 'default'] = digest(calm)
    }
    expect(pinned).toMatchSnapshot()
  })

  it('builds the same world bible on every route', () => {
    const pinned: Record<string, string> = {}
    for (const promptRoute of [...ROUTES, 'music'] as const) {
      const base = {
        promptRoute,
        script: 'In 1905 a patent clerk rewrote physics.',
        userAssetContext: { characters: [], objects: [] },
      }
      const legacy = buildLongTakeWorldBibleExpertPrompt({
        ...base,
        userSimulationParameters: 'Halftone',
      })
      const enriched = buildLongTakeWorldBibleEnrichedExpertPrompt(base)
      expect(
        buildLongTakeWorldBibleExpertPrompt({
          ...base,
          cameraStyle: 'calm',
          userSimulationParameters: 'Halftone',
        }),
      ).toBe(legacy)
      expect(buildLongTakeWorldBibleEnrichedExpertPrompt({ ...base, cameraStyle: 'calm' })).toBe(
        enriched,
      )
      pinned[promptRoute ?? 'default'] = digest(legacy)
      pinned[`enriched ${promptRoute ?? 'default'}`] = digest(enriched)
    }
    expect(pinned).toMatchSnapshot()
  })

  it('writes the same visual script prompt, looped or not', () => {
    const pinned: Record<string, string> = {}
    for (const perfectLoop of [false, true]) {
      for (const promptRoute of [...ROUTES, 'music'] as const) {
        const [unset, calm] = CALM.map((cameraStyle) =>
          buildLongTakeVisualScriptPrompt({
            ...visualScriptInput,
            cameraStyle,
            perfectLoop,
            promptRoute,
          }),
        )
        expect(calm).toBe(unset)
        pinned[`${promptRoute ?? 'default'} loop=${perfectLoop}`] = digest(calm)
      }
    }
    expect(pinned).toMatchSnapshot()
  })

  it('writes the same keyframe prompts', () => {
    const pinned: Record<string, string> = {}
    for (const promptRoute of ROUTES) {
      for (const openingInstantOnly of [false, true]) {
        for (const keyframePromptReworkEnabled of [false, true]) {
          for (const fullStyleText of [undefined, 'Halftone print collage, red and black']) {
            pinned[
              `${promptRoute ?? 'default'} opening=${openingInstantOnly} rework=${keyframePromptReworkEnabled} style=${Boolean(fullStyleText)}`
            ] = digest(
              buildLongTakeKeyframePromptsFromVisualScriptPrompt({
                fullStyleText,
                keyframePromptReworkEnabled,
                openingInstantOnly,
                promptRoute,
                visualScriptJson,
              }),
            )
            expect(
              buildLongTakeKeyframePromptsFromVisualScriptPrompt({
                cameraStyle: 'calm',
                fullStyleText,
                keyframePromptReworkEnabled,
                openingInstantOnly,
                promptRoute,
                visualScriptJson,
              }),
            ).toBe(
              buildLongTakeKeyframePromptsFromVisualScriptPrompt({
                fullStyleText,
                keyframePromptReworkEnabled,
                openingInstantOnly,
                promptRoute,
                visualScriptJson,
              }),
            )
          }
        }
      }
    }
    expect(pinned).toMatchSnapshot()
  })

  describe('keyframe headlines', () => {
    afterEach(() => jest.restoreAllMocks())

    it('puts a headline on half the title-eligible keyframes, drawn by Math.random', () => {
      for (const promptRoute of [undefined, 'abstract'] as const) {
        for (const draw of [0.49, 0.5]) {
          const random = jest.spyOn(Math, 'random').mockReturnValue(draw)
          const result = buildLongTakeKeyframePrompt({
            basePrompt: 'Einstein writes at a cluttered desk',
            globalContext: null,
            promptRoute,
            styleName: 'Halftone',
            styleText: 'Halftone print collage',
          })
          expect(random).toHaveBeenCalledTimes(1)
          expect(result.withTitle).toBe(draw < 0.5)
          expect(digest(result.prompt)).toMatchSnapshot(
            `${promptRoute ?? 'general'} title=${draw < 0.5}`,
          )
          expect(
            buildLongTakeKeyframePrompt({
              basePrompt: 'Einstein writes at a cluttered desk',
              cameraStyle: 'calm',
              globalContext: null,
              promptRoute,
              styleName: 'Halftone',
              styleText: 'Halftone print collage',
            }),
          ).toEqual(result)
          expect(random).toHaveBeenCalledTimes(2)
          random.mockRestore()
        }
      }
    })
  })

  it('asks Hailuo 3 for the next whole second, 5-15 s (snapDuration)', () => {
    const caps = videoModelCapabilities('minimax-h3-max-turbo')
    for (const [slot, seconds] of [
      [2.6, 5],
      [6.22, 7],
      [7.08, 8],
      [20, 15],
    ] as const) {
      expect(snapDuration(caps, slot)).toBe(seconds)
      expect(hailuoGenerationSeconds(slot)).toBe(seconds)
    }
  })

  it('keeps the 1.1x speed-up cap', () => {
    expect(RETIME_MAX_SPEED_MULTIPLIER).toBe(1.1)
    expect(retimeMaxSpeedFor('calm')).toBe(1.1)
    expect(retimeMaxSpeedFor(undefined)).toBe(1.1)
    expect(retimeMaxSpeedFor(null)).toBe(1.1)
  })
})
