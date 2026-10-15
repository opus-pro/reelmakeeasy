/**
 * MiniMax TTS synthesis via fal.ai. This is the only MiniMax speech
 * path: there is no direct MiniMax client.
 *
 * The endpoint comes from the model registry (`roles["tts.minimax"]`, by default
 * `fal-ai/minimax/speech-2.8-hd`), a near 1:1 passthrough of MiniMax's own T2A v2
 * endpoint. The payload is built by `minimax-text.ts`'s `buildTTSPayload`, the
 * same builder MiniMax's own API expects.
 *
 * Four payload deltas versus MiniMax's own API are handled here and nowhere else:
 *
 * 1. The script travels under BOTH `prompt` and `text`. `speech-2.8-hd` requires
 *    `prompt`; `text` is the older `speech-02-hd` spelling that 2.8 also answers.
 * 2. `pronunciation_dict` carries BOTH `tone` and `tone_list`. MiniMax reads `tone`;
 *    fal's schema declares `tone_list`. The app sends a built-in dictionary on every
 *    request, so getting this wrong would silently drop every pronunciation override
 *    rather than fail loudly.
 * 3. Output is a `File { url }` to download, not hex bytes inline.
 * 4. There is no `stream` and no low-latency endpoint, so
 *    `useLowLatencyEndpoint` is accepted-and-ignored rather than rejected --
 *    the router passes one `TTSOptions` shape to every provider.
 *
 * IMPORTANT: this module owns a PRIVATE fal client built with
 * `createFalClient`. It must never call `fal.config()`, which swaps the
 * process-global singleton and would repoint every other fal call in the
 * process (kling lipsync, avatar uploads, reframe processors) at this module's
 * credential. When a shared per-module client helper lands, hoist
 * `getFalClient` into it and delete the local copy.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { fal, type FalClient } from '@reelmakeeasy/llm'
import { minimaxSpeechEndpoint } from '@reelmakeeasy/llm/adapters'
import { type ResolvedModel, resolveRole } from '@reelmakeeasy/llm/registry'

import { logger } from '../logger'
import { ensureError } from '../utils/error-handler'

import {
  buildTTSPayload,
  determineTtsOutputPaths,
  getEffectiveModel,
  normalizeMiniMaxTtsText,
  optimizeScriptForSpeech,
  type TTSOptions,
  type TTSResult,
} from './minimax-text'
import { reportTTSCost } from './reporter'
import {
  shouldUseStoredStoryLoaderAudio,
  STORY_LOADER_VOICE_OVER_KEY,
  writeStoryLoaderVoiceOverToStore,
} from './story-loader-audio'

/** The registry's MiniMax speech model. Throws when the role is disabled or not on fal. */
export function resolveFalMinimaxSpeechModel(): ResolvedModel {
  const model = resolveRole('tts.minimax')
  if (!model) {
    throw new Error('No model is configured for role tts.minimax in reelmakeeasy.models.json')
  }
  if (model.provider !== 'fal') {
    throw new Error(`roles["tts.minimax"] must be a fal model, got provider "${model.provider}"`)
  }
  return model
}

/** The fal endpoint MiniMax speech is synthesized on, from `roles["tts.minimax"]`. */
export function falMinimaxTtsEndpoint(): string {
  return minimaxSpeechEndpoint(resolveFalMinimaxSpeechModel())
}

/**
 * The MiniMax model id an endpoint serves (`fal-ai/minimax/speech-2.8-hd` ->
 * `speech-2.8-hd`). Used for logs and cost reporting, which key on the model id.
 */
export function falMinimaxModelName(endpoint: string): string {
  return endpoint.split('/').findLast(Boolean) ?? endpoint
}

/**
 * Client-side deadlines. Both external calls must be bounded: this function is
 * awaited inside a voiceover attempt, so a stalled fal request or a hung CDN
 * download would block the retry ladder above it instead of failing over.
 * Matches the shape used for the kling lipsync fal call in
 * `story-mode-runtime/activities/long-take/transition-lipsync.ts`.
 */
const FAL_TTS_SUBSCRIBE_TIMEOUT_MS = 300_000
const FAL_TTS_DOWNLOAD_TIMEOUT_MS = 120_000

let cachedClient: FalClient | undefined

/**
 * Lazily-built, memoized private client. Credentials resolve from `FAL_KEY` at
 * first use (not module load) so importing this module never throws in a process
 * that has no fal credential and never reaches a fal endpoint.
 */
function getFalClient(): FalClient {
  if (!cachedClient) {
    const credentials = process.env['FAL_KEY']
    if (!credentials) {
      throw new Error('FAL_KEY environment variable is required for fal-hosted MiniMax TTS')
    }
    cachedClient = fal
  }
  return cachedClient
}

/** Test seam: drop the memoized client so a later call re-reads `FAL_KEY`. */
export function resetFalTtsClientForTesting(): void {
  cachedClient = undefined
}

/**
 * Fal's response for the speech endpoint. `fal-ai/minimax/speech-2.8-hd` is not
 * in `@fal-ai/client`'s generated `EndpointTypeMap` (only `speech-02-*` are), so
 * `subscribe` returns `any` and the shape has to be asserted here rather than by
 * the compiler.
 */
interface FalMinimaxTtsOutput {
  audio?: {
    content_type?: string
    file_name?: string
    file_size?: number
    url?: string
  }
  duration_ms?: number
}

/**
 * Build the fal request from MiniMax's own payload builder.
 *
 * Fal serves the same MiniMax model, so the payload is MiniMax's payload -- built by
 * the same function, with the same built-in pronunciation dictionary, the same
 * emotion suppression and the same untouched `language_boost`. Only the deltas that
 * are genuinely transport-level are adapted here:
 *
 * Both the script field and the pronunciation key are sent under BOTH spellings. This
 * is deliberate redundancy, not indecision: fal returns 200 for an unknown key and
 * validates neither, so a wrong spelling is silently IGNORED rather than rejected --
 * the failure mode is pronunciation quietly not applying, with no error anywhere to
 * trace. Sending both is the only spelling-independent option, and an ignored extra
 * key costs nothing.
 *
 * 1. The script goes out as `prompt` and `text`. `MinimaxSpeech28HdInput` lists
 *    `prompt` as its only required field and has no `text` property, while
 *    `speech-02-hd` requires `text`; 2.8 answers a `text`-only body today, but only
 *    through an undocumented alias it is free to drop.
 * 2. `pronunciation_dict` carries `tone` and `tone_list` with identical entries.
 *    `tone` is MiniMax's native spelling and fal is a passthrough to MiniMax;
 *    `tone_list` is what fal's own `PronunciationDict` schema declares, identically on
 *    `speech-02-hd` and `speech-2.8-hd`.
 * 3. `output_format` is `url` (a downloadable File) rather than MiniMax's inline hex.
 * 4. `model` and `stream` are dropped: the fal endpoint is model-specific and has no
 *    streaming mode, so both are meaningless in its schema.
 *
 * Deliberately NOT re-deriving anything. An earlier version rebuilt the payload by
 * hand and clamped `language_boost` and `emotion` to allowlists taken from fal's
 * generated types for the sibling `speech-02-hd` endpoint. That silently dropped 16
 * languages MiniMax supports and any emotion outside a 7-value set, which is exactly
 * the class of divergence this reuse exists to prevent.
 */
export function buildFalTtsInput(
  processedText: string,
  options: TTSOptions,
): Record<string, unknown> {
  const payload = buildTTSPayload(processedText, options)
  const {
    model: _model,
    output_format: _outputFormat,
    pronunciation_dict: pronunciationDict,
    stream: _stream,
    text,
    ...shared
  } = payload as Record<string, unknown>

  // Both script spellings -- see the header. `text` is what buildTTSPayload emits and
  // what speech-02-hd requires; `prompt` is what speech-2.8-hd declares as required.
  const input: Record<string, unknown> = { ...shared, output_format: 'url', prompt: text, text }

  // Both pronunciation spellings, identical entries -- see the header.
  const tone = (pronunciationDict as undefined | { tone?: string[] })?.tone
  if (tone?.length) {
    input['pronunciation_dict'] = { tone, tone_list: tone }
  }

  return input
}

/**
 * Synthesize speech through fal-hosted MiniMax.
 *
 * Never throws: returns `{ status: 'error', message }` on failure so the caller's
 * retry ladder decides what to do. `traceId` carries fal's `requestId` so a
 * generation can be traced in the fal dashboard.
 */
export async function textToSpeech(options: TTSOptions): Promise<TTSResult> {
  try {
    if (!options.text?.trim()) {
      throw new Error('Text is required for TTS.')
    }
    if (!options.voiceId) {
      throw new Error('voiceId must be provided.')
    }

    const client = getFalClient()

    // Long-form chunking optimizes the whole script once and sets
    // skipScriptOptimization so every chunk speaks the same normalized text.
    const processedText = options.skipScriptOptimization
      ? normalizeMiniMaxTtsText(options.text)
      : await optimizeScriptForSpeech(options.text)

    // The fal endpoint is model-specific, so an explicitly requested model that
    // is not the registry's would be a silent substitution. Log it and report the
    // model actually used, never the one asked for.
    const speechModel = resolveFalMinimaxSpeechModel()
    const endpoint = minimaxSpeechEndpoint(speechModel)
    const modelUsed = falMinimaxModelName(endpoint)
    const requestedModel = getEffectiveModel(options)
    if (requestedModel !== modelUsed) {
      logger.info(
        `[FalMiniMax] Requested model ${requestedModel} is not the configured endpoint; using ${endpoint}`,
      )
    }

    // Registry `input` merges last so reelmakeeasy.models.json can override any field.
    const input = { ...buildFalTtsInput(processedText, options), ...speechModel.input }

    const result = await client.subscribe(endpoint, {
      input,
      timeout: FAL_TTS_SUBSCRIBE_TIMEOUT_MS,
    })
    const traceId = result.requestId || 'none'
    const output = result.data as FalMinimaxTtsOutput | undefined
    const audioUrl = output?.audio?.url

    if (!audioUrl) {
      logger.warn({ traceId }, '[FalMiniMax] No audio url in response')
      return {
        message: 'TTS generated but no audio content returned.',
        status: 'success',
        traceId,
      }
    }

    // Reported here -- after fal returned audio, BEFORE we download it -- on
    // purpose. `subscribe` only resolves
    // once the generation completed, so fal has already billed us by this point;
    // a later download or write failure does not refund it. Moving this below the
    // download would therefore UNDER-count real spend, and since each retry is a
    // genuinely new vendor charge, one cost point per resolved generation is the
    // correct accounting. `projectId` wins over `costProjectId` so spend follows
    // the artifact's project.
    reportTTSCost('fal', modelUsed, processedText.length, {
      projectId: options.projectId ?? options.costProjectId,
    })

    const audioBuffer = await downloadAudio(audioUrl)

    // With a projectId the durable artifact goes to storage at the shared
    // cross-pod key; without one it lands on local disk.
    if (shouldUseStoredStoryLoaderAudio(options.projectId)) {
      await writeStoryLoaderVoiceOverToStore(options.projectId, audioBuffer)
      logger.info(
        {
          traceId,
          storagePath: STORY_LOADER_VOICE_OVER_KEY,
          fileSize: audioBuffer.length,
          durationMs: output?.duration_ms,
        },
        '[FalMiniMax] Audio file saved to storage',
      )
      return {
        message: 'TTS generated and saved.',
        status: 'success',
        outputPath: STORY_LOADER_VOICE_OVER_KEY,
        preprocessedText: processedText,
        traceId,
      }
    }

    const { outputPath, relativeOutputPath } = determineTtsOutputPaths(options)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, audioBuffer)
    logger.info(
      { traceId, outputPath, fileSize: audioBuffer.length, durationMs: output?.duration_ms },
      '[FalMiniMax] Audio file saved',
    )

    return {
      message: 'TTS generated and saved.',
      status: 'success',
      outputPath: relativeOutputPath,
      preprocessedText: processedText,
      traceId,
    }
  } catch (error) {
    // fal reduces a rejected input to a bare "Unprocessable Entity"; which field it rejected,
    // and why, lives only in the validation body.
    const message = ensureError(error).message
    logger.error({ err: message, voiceId: options.voiceId }, '[FalMiniMax] TTS operation failed')
    return { message, status: 'error', traceId: 'none' }
  }
}

async function downloadAudio(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FAL_TTS_DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Failed to download fal TTS audio: ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}
