import { type GlobalConstraints } from '@agent-lib/agents/visual-script/visual-script-type'
import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { JobContext } from '@reelmakeeasy/common/job-context'
import { z } from 'zod'

import type {
  GenerateLongTakeKeyframePromptsActivityParams,
  GenerateLongTakeKeyframePromptsActivityResult,
  GenerateLongTakeVisualNotesActivityParams,
  GenerateLongTakeVisualNotesActivityResult,
  GenerateLongTakeVisualScriptActivityParams,
  GenerateLongTakeVisualScriptActivityResult,
} from '../../workflows/long-take/types'
import { type LongTakeAssetManifestOutput } from '../long-take-experts-analysis'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import { buildLongTakeKeyframePromptsFromVisualScriptPrompt } from '../prompts/long-take-keyframe-prompts-from-visual-script-prompt'
import { buildLongTakeVisualScriptPrompt } from '../prompts/long-take-visual-script-prompt'

import {
  formatError,
  formatLogFields,
  getLongTakeVisualScriptConfig,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { readLongTakeMusicContext } from './music-beat-sheet'
import {
  buildAnchorImageContentsForVisualScript,
  buildFallbackLongTakeKeyframePromptsOutput,
  createLongTakeStorage,
  getLongTakeAnchorLookup,
  LONG_TAKE_GLOBAL_CONSTRAINTS_PATH,
  LONG_TAKE_KEYFRAME_PROMPTS_PATH,
  LongTakeKeyframePromptsModelOutputSchema,
  type LongTakeVisualScriptItem,
  LongTakeVisualScriptSchema,
  normalizeGlobalConstraintText,
  normalizeLongTakeKeyframePromptsOutput,
  readLongTakeAssetManifestOutput,
  readLongTakeAssetManifestOutputOrEmpty,
  readLongTakeBeatSheetOutput,
  readLongTakeUserAssetContent,
  readLongTakeWorldBibleOutput,
  resolveLongTakeVisualScriptTemperature,
} from './storage'

// Original full style description, handed off to story-mode by the v2
// confirm orchestration. Kept local (storage.ts is at its max-lines cap).
// Exported for the restyle path, which overwrites this file with the
// NEW style instead of the copied one.
export const LONG_TAKE_STYLE_SOURCE_PATH = 'long_take/style_source.json'

const LongTakeVisualScriptModelResponseSchema = z.union([
  LongTakeVisualScriptSchema,
  z.object({
    shots: LongTakeVisualScriptSchema,
  }),
])

const INSTRUMENTAL_VOCAL_CUE_PATTERN =
  /\b(?:sing|sings|singing|sang|sung|rap|raps|rapping|rapper|speak|speaks|speaking|spoken|vocals?|vocalist|lip[-\s]?syncs?|lip[-\s]?syncing|mouth|mouths|mouthing|mouthed|lips?|lyrics?)\b/i
const INSTRUMENTAL_NON_VOCAL_DESCRIPTION =
  'Non-vocal instrumental beat: people may remain on screen as dancers, walkers, listeners, or expressive performers using body movement, posture, eye contact, gestures, camera, lighting, wardrobe, and environment energy. Mouths stay closed or neutral.'
const INSTRUMENTAL_NO_MOUTH_DIRECTIVE =
  'This empty-lyrics beat stays non-vocal; mouths stay closed or neutral throughout.'

export async function generateLongTakeKeyframePrompts(
  params: GenerateLongTakeKeyframePromptsActivityParams,
): Promise<GenerateLongTakeKeyframePromptsActivityResult> {
  const { openingInstantOnly, pipelineContext, projectId, promptRoute, userId } = params
  return withLongTakeContext({ pipelineContext, projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir('long_take')

      const writeOutput = async (
        output: ReturnType<typeof buildFallbackLongTakeKeyframePromptsOutput>,
      ) => {
        // Record the stylization decision on the artifact (baked style
        // vs not). Readers of this file parse `shots` via a non-strict zod schema,
        // so this extra sibling key is stripped on read and cannot break them.
        await storage.writeJsonFile(LONG_TAKE_KEYFRAME_PROMPTS_PATH, {
          ...output,
          stylized: false,
        })
        const promptByShotId = Object.fromEntries(
          output.shots
            .map((item) => [item.shot_id?.trim(), item.prompt_base?.trim()] as const)
            .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
        )
        return {
          outputPath: LONG_TAKE_KEYFRAME_PROMPTS_PATH,
          // Omitted rather than empty so the no-visual-script early return keeps
          // the exact result shape V2 callers have always seen.
          ...(Object.keys(promptByShotId).length > 0 && { promptByShotId }),
          shotCount: output.shots.length,
          stylizeKeyframes: false,
        }
      }

      let visualScript: LongTakeVisualScriptItem[] = []
      try {
        visualScript = await storage.readJsonFile<LongTakeVisualScriptItem[]>(
          'long_take/visual_script.json',
        )
      } catch {
        visualScript = []
      }

      if (!visualScript.length) {
        return writeOutput({ shots: [] })
      }

      try {
        logger.info(
          `[long-take] Keyframe prompt inputs resolved ${formatLogFields({
            projectId,
            shotCount: visualScript.length,
          })}`,
        )
        const prompt = await buildLongTakeKeyframePromptsFromVisualScriptPrompt({
          openingInstantOnly,
          promptRoute,
          visualScriptJson: JSON.stringify(visualScript, null, 2),
        })
        const modelOutput = await JobContext.run({ projectId, userId }, async () =>
          runLongTakeCompletionWithRecord({
            projectId,
            userId,
            options: {
              models: ['gemini-3.8-flash', 'gemini-2.5-pro', 'gpt-5'],
              prompt,
              responseFormat: LongTakeKeyframePromptsModelOutputSchema,
              task: 'long-take-keyframe-prompts',
              temperature: 0,
            },
          }),
        )
        const { output, unauthoredShotIds } = normalizeLongTakeKeyframePromptsOutput({
          modelOutput,
          visualScript,
        })
        // The model returned no prompt_base for these; they fell back to the raw
        // description. Warned rather than thrown: one missing shot must not cost
        // the other nineteen their authored prompts. Silent until now -- the
        // output is well-formed either way, so this line is the only signal.
        if (unauthoredShotIds.length > 0) {
          logger.warn(
            `[long-take] Keyframe prompts missing for some shots, raw description used ${formatLogFields(
              {
                projectId,
                shotIds: unauthoredShotIds.join(','),
                unauthoredCount: unauthoredShotIds.length,
                visualScriptLength: visualScript.length,
              },
            )}`,
          )
        }
        const result = await writeOutput(output)
        logger.info(
          `[long-take] Keyframe prompts generated ${formatLogFields({
            projectId,
            path: result.outputPath,
            shotCount: result.shotCount,
            unauthoredCount: unauthoredShotIds.length,
            durationMs: Date.now() - startedAt,
          })}`,
        )
        return result
      } catch (error) {
        logger.warn(
          `[long-take] Keyframe prompts generation failed, fallback applied ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return writeOutput(buildFallbackLongTakeKeyframePromptsOutput(visualScript))
      }
    }),
  )
}

export async function generateLongTakeVisualNotes(
  params: GenerateLongTakeVisualNotesActivityParams,
): Promise<GenerateLongTakeVisualNotesActivityResult> {
  const { pipelineContext, projectId, userId } = params
  return withLongTakeContext({ pipelineContext, projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      let script = ''
      try {
        script = await storage.readTextFile(STORY_LOADER_PATHS.scriptTxtPath)
      } catch (error) {
        logger.warn(
          `[long-take] Missing script for notes ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
      }

      let assetNames: string[] = []
      try {
        const userAssetContent = await readLongTakeUserAssetContent(storage)
        assetNames = userAssetContent.files
          .map((f) => f.shortname?.trim())
          .filter((name): name is string => Boolean(name))
      } catch {
        // ok if missing - no user assets uploaded
      }

      const notes = await generateLongTakeVisualNotesFromScript({
        assetNames,
        projectId,
        script,
        userId,
      })
      await storage.ensureDir('long_take')
      const notesPath = 'long_take/visual_notes.json'
      await storage.writeJsonFile(notesPath, notes)

      logger.info(
        `[long-take] Visual notes saved ${formatLogFields({
          projectId,
          noteCount: notes.length,
          notesPath,
        })}`,
      )

      return { noteCount: notes.length, notesPath }
    }),
  )
}

export async function generateLongTakeVisualScript(
  params: GenerateLongTakeVisualScriptActivityParams,
): Promise<GenerateLongTakeVisualScriptActivityResult> {
  const {
    cameraStyle,
    perfectLoop,
    pipelineContext,
    projectId,
    promptRoute,
    transitionVideoModel,
    tolerateMissingAssetManifest,
    userId,
    userPrompt,
    visualScriptTemperature,
  } = params
  const resolvedVisualScriptTemperature =
    resolveLongTakeVisualScriptTemperature(visualScriptTemperature)
  return withLongTakeContext({ pipelineContext, projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)

      try {
        await storage.ensureDir('long_take')
        const scriptText = await storage.readTextFile(STORY_LOADER_PATHS.scriptTxtPath)
        const config = getLongTakeVisualScriptConfig()

        const beatSheet = await readLongTakeBeatSheetOutput(storage)
        if (!beatSheet.beat_sheet.length) {
          if (promptRoute === 'music') {
            throw new Error(
              'Music video route requires a music beat sheet, but no music beats were generated.',
            )
          }
          throw new Error(
            'Story Mode requires audio with speech or lyrics. Instrumental or music-only audio is not supported.',
          )
        }
        const assetManifest = tolerateMissingAssetManifest
          ? await readLongTakeAssetManifestOutputOrEmpty(storage)
          : await readLongTakeAssetManifestOutput(storage)
        const worldBible = await readLongTakeWorldBibleOutput(storage)
        const userAssetContent = await readLongTakeUserAssetContent(storage)
        const beatCount = beatSheet.beat_sheet.length

        // The UIP confirm orchestration pre-writes global_constraints.json with brand_scope /
        // target_audience / script_language from the session spec. The world bible carries none
        // of these fields, so keep them from the existing file for downstream prompts.
        let existingConstraints: GlobalConstraints | null | undefined
        try {
          existingConstraints = await storage.readJsonFile<GlobalConstraints>(
            LONG_TAKE_GLOBAL_CONSTRAINTS_PATH,
          )
        } catch {
          existingConstraints = null
        }

        // Derive global constraints from world bible (no separate LLM call needed)
        const gc = worldBible.global_context
        const scriptCategory =
          gc?.script_category === 'object_centric' ? 'object_centric' : 'concept_centric'
        const globalConstraints: GlobalConstraints = {
          video_type: gc?.video_type || '',
          script_category: scriptCategory,
          topic: gc?.topic || '',
          key_entities: gc?.key_entities || [],
          geo_scope: gc?.geo_scope || '',
          time_scope: gc?.time_scope || '',
          brand_scope: existingConstraints?.brand_scope || '',
          target_audience: existingConstraints?.target_audience || '',
          tone: gc?.tone || '',
          script_language: existingConstraints?.script_language || '',
          // Preserve the user's positive directives forwarded from UIP (the
          // world-bible has no slot for them, same as brand_scope/audience).
          directives: existingConstraints?.directives || [],
          must_not_violate: gc?.creative_guardrails || [],
        }
        await storage.writeJsonFile(LONG_TAKE_GLOBAL_CONSTRAINTS_PATH, globalConstraints)

        // On the music route, feed the song's genre + section structure (written by
        // buildLongTakeMusicBeatSheet) into the prompt so the LLM writes visuals that match the music.
        const musicContext =
          promptRoute === 'music' ? await readLongTakeMusicContext(storage) : null
        const musicContextJson = musicContext ? JSON.stringify(musicContext, null, 2) : undefined

        const prompt = await buildLongTakeVisualScriptPrompt({
          assetManifest,
          beatSheet,
          cameraStyle,
          config,
          globalConstraints,
          musicContextJson,
          perfectLoop,
          promptRoute,
          script: scriptText,
          transitionVideoModel,
          userPrompt,
          userAssetContent,
          worldBible,
        })
        const anchorImageContents = await buildAnchorImageContentsForVisualScript(
          storage,
          projectId,
        )
        // User uploads / brand anchors injected at UIP confirm live in the anchor index but not
        // in the experts asset manifest; allow their ids as used_asset_id bindings so a visual
        // script (re)generation keeps user-pinned assets. The lookup is TTL-cached per project,
        // so this re-read after buildAnchorImageContentsForVisualScript costs no extra IO.
        const anchorAssetIds = [...(await getLongTakeAnchorLookup(storage, projectId)).keys()]
        const rawResponse = await JobContext.run({ projectId, userId }, async () =>
          runLongTakeCompletionWithRecord({
            projectId,
            userId,
            options: {
              ...(anchorImageContents.length > 0 && { contents: anchorImageContents }),
              models: ['gemini-3.8-flash', 'gemini-2.5-pro', 'gpt-5'],
              prompt,
              responseFormat: LongTakeVisualScriptModelResponseSchema,
              task: 'long-take-visual-script',
              temperature: resolvedVisualScriptTemperature,
            },
          }),
        )

        const modelResponse = Array.isArray(rawResponse) ? rawResponse : rawResponse.shots
        const response: LongTakeVisualScriptItem[] = await normalizeVisualScriptResponseByBeat({
          assetManifest,
          beatSheet,
          extraAllowedAssetIds: anchorAssetIds,
          modelResponse,
          perfectLoop,
          promptRoute,
        })

        const visualScriptPath = 'long_take/visual_script.json'
        await storage.writeJsonFile(visualScriptPath, response)

        logger.info(
          `[long-take] Visual script generated ${formatLogFields({
            projectId,
            userId,
            scriptLength: scriptText.length,
            itemCount: response.length,
            beatCount,
            visualScriptPath,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          itemCount: response.length,
          visualScriptPath,
        }
      } catch (error) {
        logger.error(
          `[long-take] Visual script generation failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        throw error
      }
    }),
  )
}

function buildLongTakeVisualNotesPrompt(script: string, assetNames?: string[]): string {
  const hasAssets = assetNames && assetNames.length > 0
  const assetSection = hasAssets ? `\nUser-uploaded assets: ${JSON.stringify(assetNames)}\n` : ''

  return `Role:
You are an expert Story Mode visual planner.

Task:
Extract short, concrete visual planning notes from the script and the user's original request (provided in Pipeline Context above).

Rules:
- Base notes only on the script and user request. Do NOT add new facts.
- Capture any explicit requirements or constraints that affect visuals or shot planning.
- Include requested elements, comparisons, settings, tone, or style constraints.
- If the user's request mentions how or where to use specific assets (e.g., "put my logo at the end",
  "use my product image in the opening"), extract these as notes prefixed with "[ASSET INTENT]".${
    hasAssets
      ? ' Match intent to specific asset filenames from the uploaded assets list when possible.'
      : ''
  }
- If the script/request contains no such requirements, return [].
- Keep each note short and concrete.
- Use the same language as the script.

Output:
Return a JSON array of strings. Example: ["note 1", "[ASSET INTENT] note 2"] or [].
${assetSection}
SCRIPT:
${script}
`
}

async function generateLongTakeVisualNotesFromScript(params: {
  assetNames?: string[]
  projectId: string
  script: string
  userId: string
}): Promise<string[]> {
  const { assetNames, projectId, script, userId } = params
  if (!script.trim()) {
    return []
  }

  try {
    const response = await JobContext.run({ projectId, userId }, async () =>
      runLongTakeCompletionWithRecord({
        projectId,
        userId,
        options: {
          models: ['gemini-3.8-flash', 'gpt-5'],
          prompt: buildLongTakeVisualNotesPrompt(script, assetNames),
          responseFormat: z.array(z.string()),
          task: 'long-take-visual-notes',
          temperature: 0.2,
        },
      }),
    )

    const normalized = (response ?? [])
      .map((note) => (typeof note === 'string' ? note.trim() : ''))
      .filter((note) => note.length > 0)
    return Array.from(new Set(normalized))
  } catch (error) {
    logger.warn(
      `[long-take] Failed to generate visual notes ${formatLogFields({
        projectId,
        err: formatError(error),
      })}`,
    )
    return []
  }
}

function normalizeInstrumentalNoMouthText<T extends null | string>(value: T, enabled: boolean): T {
  if (!enabled || value === null) {
    return value
  }
  const text = INSTRUMENTAL_VOCAL_CUE_PATTERN.test(value)
    ? INSTRUMENTAL_NON_VOCAL_DESCRIPTION
    : value
  if (text.includes(INSTRUMENTAL_NO_MOUTH_DIRECTIVE)) {
    return text as T
  }
  return `${text}\n${INSTRUMENTAL_NO_MOUTH_DIRECTIVE}` as T
}

function normalizeVisualScriptResponseByBeat(params: {
  assetManifest: LongTakeAssetManifestOutput
  beatSheet: Awaited<ReturnType<typeof readLongTakeBeatSheetOutput>>
  /** Asset ids bindable beyond the manifest (e.g. anchor-index user uploads / brand assets). */
  extraAllowedAssetIds?: string[]
  modelResponse: LongTakeVisualScriptItem[]
  perfectLoop?: boolean
  promptRoute?: GenerateLongTakeVisualScriptActivityParams['promptRoute']
}): LongTakeVisualScriptItem[] {
  const {
    assetManifest,
    beatSheet,
    extraAllowedAssetIds,
    modelResponse,
    perfectLoop,
    promptRoute,
  } = params
  const allowedAssetIds = new Set([
    ...(extraAllowedAssetIds ?? []),
    ...assetManifest.asset_manifest.map((item) => item.asset_id),
  ])
  const byShotId = new Map(
    modelResponse
      .map((item) => [item.shot_id?.trim(), item] as const)
      .filter((item): item is [string, LongTakeVisualScriptItem] => Boolean(item[0])),
  )

  return beatSheet.beat_sheet.map((beat, index) => {
    const targetShotId = String(beat.beat_id)
    const source = byShotId.get(targetShotId) || modelResponse[index]
    const fallbackCore = beat.segment_text.trim() || 'Visual representation'
    const sourceVisual = source?.visual
    const coreDescription =
      normalizeGlobalConstraintText(sourceVisual?.core_description) ||
      normalizeGlobalConstraintText(sourceVisual?.description) ||
      fallbackCore
    const normalizedUsedAssetIds = Array.from(
      new Set(
        (source?.used_asset_id || [])
          .map((item) => item.trim())
          .filter((item) => item.length > 0 && allowedAssetIds.has(item)),
      ),
    )

    const isFirst = index === 0
    const isLast = index === beatSheet.beat_sheet.length - 1
    const entryRaw = normalizeGlobalConstraintText(sourceVisual?.entry_action)
    const exitRaw = normalizeGlobalConstraintText(sourceVisual?.exit_action)
    const isInstrumentalMusicBeat = promptRoute === 'music' && beat.segment_text.trim().length === 0
    const humanPresence =
      isInstrumentalMusicBeat && source?.human_presence === 'singer_performance'
        ? 'specific_character'
        : (source?.human_presence ?? 'unknown')
    const entryAction = perfectLoop
      ? entryRaw || coreDescription
      : isFirst
        ? null
        : entryRaw || coreDescription
    const exitAction = perfectLoop
      ? exitRaw || coreDescription
      : isLast
        ? null
        : exitRaw || coreDescription

    return {
      audio: isInstrumentalMusicBeat ? '' : source?.audio?.trim() || beat.segment_text,
      human_presence: humanPresence,
      shot_id: targetShotId,
      used_asset_id: normalizedUsedAssetIds,
      visual: {
        aesthetic_mode: sourceVisual?.aesthetic_mode ?? null,
        availability: sourceVisual?.availability ?? null,
        core_description: normalizeInstrumentalNoMouthText(
          coreDescription,
          isInstrumentalMusicBeat,
        ),
        entry_action: normalizeInstrumentalNoMouthText(entryAction, isInstrumentalMusicBeat),
        exit_action: normalizeInstrumentalNoMouthText(exitAction, isInstrumentalMusicBeat),
        expression_type: sourceVisual?.expression_type ?? null,
        notes: sourceVisual?.notes ?? null,
      },
    }
  })
}
