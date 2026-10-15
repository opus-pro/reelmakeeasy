import { generateImage } from '@reelmakeeasy/common/llm'
import { Content } from '@reelmakeeasy/common/llm/clients/client'
import { completion, type ModelChain } from '@reelmakeeasy/common/llm/completion'
import { imageModelForRole } from '@reelmakeeasy/common/llm/image-model-selection'
import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { storeUri, uploadBufferToStore } from '@reelmakeeasy/common/storage/stored-files'
import { BadRequestException, Injectable } from '@nestjs/common'
import { z } from 'zod'

import {
  SCENE_PROMPT_GENERATION_SYSTEM,
  SCENE_SAMPLE_IDS,
  STYLE_ANALYZER_PROMPT,
  STYLE_ANALYZER_TEXT_ADDENDUM,
} from './style-analyzer.prompts'

// Mirrors the playground's StyleAnalysisSchema (analyze-batch). The
// `reusableStylePrompt` is what gets mapped to `UserSavedStyle.styleText`;
// the remaining fields are the structured extras persisted in the additive
// `styleMetadata` column.
// Each palette group is a list of `"Name (#RRGGBB) - NN%"` strings; the web
// client parses the hex + usage out of that format (see CustomStylePlaceholder
// `parsePalette`).
const ColorPaletteSchema = z.object({
  primary: z.array(z.string()).nullable(),
  secondary: z.array(z.string()).nullable(),
  accent: z.array(z.string()).nullable(),
})

export type ColorPalette = z.infer<typeof ColorPaletteSchema>

const StyleAnalysisSchema = z.object({
  summary: z.string(),
  analysis: z.object({
    visualRules: z.array(z.string()),
    intent: z.string(),
    staysConsistent: z.array(z.string()),
    canFlex: z.array(z.string()),
    failureModes: z.array(z.string()),
  }),
  colorPalette: ColorPaletteSchema,
  reusableStylePrompt: z.string(),
  // FACE DEPICTION LOGIC section of the V6 analyzer (how faces are constructed
  // in this style). Null for photorealistic styles, where the prompt tells the
  // model to skip the section. Captured so the full style -- not just
  // the distilled reusableStylePrompt -- can be assembled for generation.
  // `.default(null)` so a response that omits the key still parses (the prompt
  // explicitly says to skip the section for realistic styles).
  faceDepiction: z.string().nullable().default(null),
})

export type StyleAnalysisResult = z.infer<typeof StyleAnalysisSchema>

// Output of the scene-sample GENERATE step: exactly 3 non-empty
// image-gen prompts. `.min(1)` keeps an empty/packed element from satisfying
// the contract; generateScenePrompts re-checks the count as belt-and-suspenders
// for callers (e.g. tests) that bypass schema validation.
const ScenePromptsSchema = z.object({
  prompts: z.array(z.string().min(1)).length(SCENE_SAMPLE_IDS.length),
})

export interface SceneSampleResult {
  archetypeId: string
  imageUrl: string
  label: string
}

// LLM models. Text analysis mirrors style-text.service.ts. Sample
// images render on the registry's image roles (image.edit when reference
// images are supplied, image.generate otherwise).
const ANALYZE_MODELS = ['gemini-3.8-flash', 'gpt-4o-mini'] as const satisfies ModelChain

const MAX_REFS = 8

const ANALYZE_TASK = 'custom-style-analyze'
const SCENE_PROMPTS_TASK = 'custom-style-scene-prompts'
const SAMPLES_TASK = 'custom-style-samples'

// The spec fixes the sample count at 3 dynamically-generated scenes.
const SCENE_SAMPLE_COUNT = SCENE_SAMPLE_IDS.length

// Flatten the grouped palette into labelled lines so the scene-prompt model sees
// the exact entries to follow.
function formatPaletteForPrompt(palette: ColorPalette): string {
  const groups: Array<[string, null | string[]]> = [
    ['Primary', palette.primary],
    ['Secondary', palette.secondary],
    ['Accent', palette.accent],
  ]
  return groups
    .flatMap(([label, list]) => (list ?? []).map((entry) => `- ${label}: ${entry}`))
    .join('\n')
}

function hasPaletteColors(palette: ColorPalette): boolean {
  return [palette.primary, palette.secondary, palette.accent].some(
    (list) => (list?.length ?? 0) > 0,
  )
}

/**
 * Custom-style generator, ported from the `style-playground` prototype.
 * Replaces the terse SCC output of StyleTextService behind the
 * `enable_custom_style_generation` gate.
 *
 * Two capabilities:
 *  - `analyzeStyle`: image(s)/text -> structured style
 *  - `generateSceneSamples`: reusable prompt -> 3 stress-test previews
 */
@Injectable()
export class StyleAnalyzerService {
  private readonly logger = new Logger(StyleAnalyzerService.name)

  /**
   * Analyze reference image(s) and/or a text description into a structured,
   * reusable style. At least one of `imageDataUrls` / `styleDescription` must
   * be present.
   */
  async analyzeStyle(input: {
    imageDataUrls?: string[]
    styleDescription?: string
  }): Promise<StyleAnalysisResult> {
    const imageDataUrls = (input.imageDataUrls ?? []).filter((u) => u?.trim()).slice(0, MAX_REFS)
    const styleDescription = input.styleDescription?.trim()

    if (imageDataUrls.length === 0 && !styleDescription) {
      throw new BadRequestException(
        'At least one reference image or a style description is required',
      )
    }
    for (const url of imageDataUrls) {
      if (!url.startsWith('data:image/')) {
        throw new BadRequestException('Only image data URLs are supported')
      }
    }

    // Text-only input swaps in the text addendum so the structured output
    // shape stays identical regardless of input mode.
    const prompt =
      imageDataUrls.length === 0 && styleDescription
        ? STYLE_ANALYZER_PROMPT +
          // Function replacer so `$`-sequences in the user's description (e.g.
          // `$&`, `$1`) are inserted literally, not treated as replacement
          // patterns by String.replace.
          STYLE_ANALYZER_TEXT_ADDENDUM.replace('{{DESCRIPTION}}', () => styleDescription)
        : STYLE_ANALYZER_PROMPT

    const contents: Content[] = [{ type: 'text', text: prompt }]
    for (const imageUrl of imageDataUrls) {
      contents.push({ type: 'image_url', imageUrl })
    }
    // When both images and a description are present, the description is a hint
    // alongside the images (images remain the primary source of truth).
    if (imageDataUrls.length > 0 && styleDescription) {
      contents.push({
        type: 'text',
        text: `Additional context from the user (a hint, not authoritative — the reference images are the source of truth):\n${styleDescription}`,
      })
    }

    try {
      return await completion({
        models: ANALYZE_MODELS,
        prompt,
        contents,
        responseFormat: StyleAnalysisSchema,
        task: ANALYZE_TASK,
        temperature: 0.3,
        responseValidator: (r) => r.reusableStylePrompt.trim().length > 0,
      })
    } catch (error) {
      const err = ensureError(error)
      this.logger.error({ error: err }, 'Failed to analyze style')
      throw new BadRequestException(`Failed to analyze style: ${err.message}`)
    }
  }

  /**
   * Render the 3 dynamically-generated scenes (a GENERATE step
   * produces 3 diverse prompts, rendered with index-based identity
   * `scene_0/1/2`) and return the finished previews. `onSample` (when supplied)
   * fires the moment each scene lands so the SSE stream can paint tiles
   * incrementally; non-stream callers (e.g. the MCP background render) just take
   * the returned array. Throws when nothing rendered. Previews upload under
   * `custom-style/{userId}/samples/`, so callers that persist them as saved-style
   * snapshots must pass the style-owning userId (the saved-style namespace key).
   */
  async generateSceneSamples(
    input: {
      palette?: ColorPalette
      refImageUrls?: string[]
      reusableStylePrompt: string
      userId: string
    },
    onSample?: (sample: SceneSampleResult) => Promise<void>,
  ): Promise<SceneSampleResult[]> {
    const reusable = input.reusableStylePrompt?.trim()
    if (!reusable) {
      throw new BadRequestException('reusableStylePrompt is required')
    }
    const refImageUrls = (input.refImageUrls ?? []).filter((u) => u?.trim()).slice(0, MAX_REFS)
    // `palette` arrives unvalidated from the request body (no pipe here), so
    // validate its shape before use -- a malformed payload would otherwise reach
    // `.map()` on a non-array in formatPaletteForPrompt and throw a raw TypeError.
    // Omitting it (or an empty palette) leaves the generated prompts palette-free.
    const parsedPalette = input.palette ? ColorPaletteSchema.safeParse(input.palette) : null
    const paletteBlock =
      parsedPalette?.success && hasPaletteColors(parsedPalette.data)
        ? formatPaletteForPrompt(parsedPalette.data)
        : ''
    // Validate refs before handing them to the image model -- they are
    // forwarded verbatim as `image_url` contents, so reject anything that
    // isn't an http(s) URL or an inline image data URL.
    for (const url of refImageUrls) {
      if (!/^https?:\/\//.test(url) && !url.startsWith('data:image/')) {
        throw new BadRequestException(`Invalid reference image URL: ${url}`)
      }
    }

    // GENERATE step: palette is fed in here so adherence is baked into each
    // prompt. Throws (no partial result) if it can't produce 3 prompts.
    const scenePrompts = await this.generateScenePrompts({ paletteBlock, reusable })

    const userId = input.userId || 'anonymous'
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const renderOne = async (prompt: string, index: number): Promise<SceneSampleResult> => {
      const sceneId = SCENE_SAMPLE_IDS[index]
      // The generated prompt is the render prompt verbatim: it already embeds
      // the style and (when defined) the palette, so there is no STYLE TO APPLY
      // wrap and no separate COLOR PALETTE steer block (supersedes the
      // earlier render-time palette block, which would now double-apply).
      const contents: Content[] = [{ type: 'text', text: prompt }]
      for (const url of refImageUrls) {
        contents.push({ type: 'image_url', imageUrl: url })
      }
      const result = await generateImage({
        models: [imageModelForRole(refImageUrls.length ? 'image.edit' : 'image.generate')],
        contents,
        prompt,
        aspectRatio: '9:16',
        task: `${SAMPLES_TASK}.${sceneId}`,
        timeout: 160_000,
      })
      const buffer = Buffer.from(result.imageBase64, 'base64')
      const fileUri = `custom-style/${userId}/samples/${sessionId}_${sceneId}.png`
      await uploadBufferToStore(buffer, storeUri(fileUri), {
        contentType: 'image/png',
      })
      return {
        archetypeId: sceneId,
        // An address: served as a URL on the way out, sent back as either.
        imageUrl: storeUri(fileUri) as string,
        label: `Scene ${index + 1}`,
      }
    }

    // Render all scenes in parallel and emit each preview the moment it lands so
    // a streaming caller paints tiles incrementally instead of waiting on the
    // slowest one. allSettled keeps one failing scene (timeout / safety block /
    // API error) from nuking the rest -- partial sets are surfaced.
    const samples: SceneSampleResult[] = []
    const failures: { error: Error; sceneId: string }[] = []
    await Promise.allSettled(
      scenePrompts.map(async (prompt, index) => {
        try {
          const sample = await renderOne(prompt, index)
          // Emit BEFORE counting the scene as delivered: on the SSE path a failed
          // onSample (bus.push to a disconnected client) must count as a failure,
          // not a success -- this preserves the old "throw only when nothing was
          // delivered" contract so a dead stream still fails via bus.fail rather
          // than ending cleanly. onSample is absent on the non-stream path.
          await onSample?.(sample)
          samples.push(sample)
        } catch (e) {
          failures.push({ error: ensureError(e), sceneId: SCENE_SAMPLE_IDS[index] })
        }
      }),
    )

    if (failures.length > 0) {
      this.logger.error(
        {
          errors: failures.map((f) => f.error),
          failedScenes: failures.map((f) => f.sceneId),
        },
        `Scene sample generation failed for ${failures.length}/${scenePrompts.length} scene(s)`,
      )
    }
    // Only hard-fail when nothing rendered; the SSE wrapper turns the throw into
    // an `error` event. A partial set is returned as-is.
    if (samples.length === 0) {
      const detail = failures[0]?.error.message ?? 'unknown error'
      throw new BadRequestException(`Failed to generate scene samples: ${detail}`)
    }
    return samples
  }

  /**
   * GENERATE step: ask the text model for 3 diverse image-generation
   * prompts tailored to this style, using the verbatim spec system prompt. The
   * palette (if any) is fed in here so the model bakes palette adherence into
   * each prompt; the render step then uses the returned prompts directly. Runs
   * hotter than analyze (the spec wants variety) and retries once on a
   * malformed/short set before failing -- there is no archetype fallback now.
   */
  private async generateScenePrompts(input: {
    paletteBlock: string
    reusable: string
  }): Promise<string[]> {
    const styleContext = input.paletteBlock
      ? `STYLE PROMPT:\n${input.reusable}\n\nCOLOR PALETTE:\n${input.paletteBlock}`
      : `STYLE PROMPT:\n${input.reusable}`
    const contents: Content[] = [
      { type: 'text', text: SCENE_PROMPT_GENERATION_SYSTEM },
      { type: 'text', text: styleContext },
    ]

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await completion({
          models: ANALYZE_MODELS,
          prompt: SCENE_PROMPT_GENERATION_SYSTEM,
          contents,
          responseFormat: ScenePromptsSchema,
          task: SCENE_PROMPTS_TASK,
          temperature: 0.8,
        })
        const prompts = result.prompts.map((p) => p.trim()).filter((p) => p.length > 0)
        // Require 3 DISTINCT prompts: the spec's whole point is diversity, and a
        // model can return near-duplicates that pass the count check. Compare on
        // whitespace-collapsed, lowercased text so trivial variants don't slip by.
        const uniqueCount = new Set(prompts.map((p) => p.replace(/\s+/g, ' ').toLowerCase())).size
        if (prompts.length === SCENE_SAMPLE_COUNT && uniqueCount === SCENE_SAMPLE_COUNT) {
          return prompts
        }
        this.logger.warn(
          {
            attempt,
            nonEmpty: prompts.length,
            returned: result.prompts.length,
            unique: uniqueCount,
          },
          'Scene prompt generation returned invalid prompts; retrying',
        )
      } catch (error) {
        this.logger.warn(
          { attempt, error: ensureError(error) },
          'Scene prompt generation failed; retrying',
        )
      }
    }
    // Terminal failure (both attempts exhausted): the user gets no previews, so
    // log at error -- alerting keys on error, and per-attempt logs are only warn.
    this.logger.error(
      { attempts: 2 },
      `Failed to generate ${SCENE_SAMPLE_COUNT} scene prompts after all attempts`,
    )
    throw new BadRequestException(`Failed to generate ${SCENE_SAMPLE_COUNT} scene prompts`)
  }
}
