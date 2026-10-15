import { createHash } from 'node:crypto'

import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { z } from 'zod'

import { getPinnedUserPrompt } from '../context-builder'
import { PLANNER_TOOL_MODELS } from '../model-config'
import {
  type Mode,
  type PromptRouteArtifact,
  UIP_PROMPT_ROUTES,
  type UipPromptRoute,
} from '../types'

import {
  getUipMusicSignalSource,
  getUipMusicTrackIneligibilityReason,
  hasUipMusicSignal,
} from './music-track-eligibility'

const logger = createSubLogger('uip-planner-runtime:prompt-route')

const PROMPT_ROUTE_CLASSIFIER_CACHE_VERSION = 2

const PromptRouteClassificationSchema = z.object({
  prompt_route: z.enum(UIP_PROMPT_ROUTES),
  reasoning: z.string(),
})

export function buildUipPromptRouteClassificationPrompt(
  confirmedScriptOrTranscript: string,
  originalUserInput?: string,
  intentMode?: Mode | null,
): string {
  const serializedScript = JSON.stringify(confirmedScriptOrTranscript.trim())
  const serializedOriginalUserInput = originalUserInput?.trim()
    ? JSON.stringify(originalUserInput.trim())
    : ''
  const originalUserInputSection = serializedOriginalUserInput
    ? `
Original user input:
"""${serializedOriginalUserInput}"""
`
    : ''
  const intentModeSection = intentMode
    ? `
Confirmed high-level UIP mode:
"""${intentMode}"""

Treat this mode as a strong intent boundary. It was confirmed upstream with the user before this route classifier runs.
`
    : ''

  return `You are choosing the downstream Story Mode prompt route.

Choose exactly one route:
- "general": Default route. Use for concrete/cinematic videos with people, places, objects, physical demonstrations, dramatized scenes, stories, dialogue, interviews, songs, poetry, live-action-style visuals, or explainers best taught through story.
- "abstract": Use for explainers taught through readable text, charts, diagrams, formulas, bullet lists, comparison tables, UI panels, infographic visuals, or editorial teaching graphics.
- "ads-tangible": Use when the user clearly wants to sell/market a physical product, venue, food/drink, beauty/fashion item, packaged good, device, or object, and the video benefits from product display, feature demo, value-prop presentation, or a clear CTA. If it is lifestyle, story-driven, cinematic, or the product is just a scene element, choose "general".
- "ads-intangible": Use when the user clearly wants to sell/market a service, app, software, course, subscription, event, community, or non-physical offer, and the video benefits from a visible product/service surface such as UI, website, dashboard, workflow, signup/booking flow, form, integration, message flow, service process, before/after result, proof panel, or clear CTA. If it is cinematic, lifestyle, testimonial, creator-led, skit, narrative, motivational, or human-only brand storytelling without a concrete product/demo surface, choose "general".
- "music": Use when music/song is the main structure of the video.

Mode rules:
- If UIP mode is "explainer", choose "general" or "abstract".
- If UIP mode is "narrative_story", choose "general" unless it is clearly a music video.
- If UIP mode is "ads", choose an ads route when there is clear selling/marketing intent; otherwise choose "general".

Return valid JSON with no extra text. The prompt_route value must be the chosen route string:
{
  "prompt_route": "general",
  "reasoning": "one short sentence"
}

Confirmed script/transcript:
"""${serializedScript}"""
${intentModeSection}
${originalUserInputSection}`
}

export function hashPromptRouteScript(
  script: string,
  originalUserInput?: string,
  intentMode?: Mode | null,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        classifierPromptVersion: PROMPT_ROUTE_CLASSIFIER_CACHE_VERSION,
        intentMode: intentMode ?? null,
        originalUserInput: originalUserInput?.trim() || '',
        script: script.trim(),
      }),
    )
    .digest('hex')
}

export function isUipPromptRoute(value: unknown): value is UipPromptRoute {
  return typeof value === 'string' && (UIP_PROMPT_ROUTES as readonly string[]).includes(value)
}

export function resolveEffectivePromptRoute(artifact: PromptRouteArtifact): UipPromptRoute {
  if (artifact.prompt_route === 'music') {
    return artifact.music_video_improvement_enabled === true ? 'music' : 'general'
  }
  if (artifact.gate_enabled !== true) {
    return 'general'
  }
  if (isUipPromptRoute(artifact.effective_prompt_route)) {
    return artifact.effective_prompt_route
  }
  return artifact.prompt_route
}

export async function resolvePromptRouteForSession(params: {
  originalUserInput?: string
  script: string
  session: {
    cached_artifacts: { prompt_route?: null | PromptRouteArtifact }
    /**
     * Quality tier for model routing. Structural, not the full
     * SessionState, so every caller that builds this literal by hand -- notably
     * the fast-confirm handoff in uip-confirm-fast-orchestration.ts -- has to
     * supply it or the route classifier silently keeps the compiled-in chain.
     */
    modelSelectorTier?: ModelSelectorAnalyticsTier
    sessionId: string
    spec: {
      meta: {
        audio_is_music?: boolean
        audio_source?: null | string
        improved_visual_script_enabled?: boolean
        is_music?: boolean
        mode_state?: { input_type?: null | string; mode?: Mode | null }
        music_video_improvement_enabled?: boolean
      }
    }
    transcript?: Parameters<typeof getPinnedUserPrompt>[0]
  }
}): Promise<PromptRouteArtifact> {
  const script = params.script.trim()
  const originalUserInput =
    params.originalUserInput?.trim() || getPinnedUserPrompt(params.session.transcript ?? [])
  const gateEnabled = params.session.spec.meta.improved_visual_script_enabled === true
  const intentMode = params.session.spec.meta.mode_state?.mode ?? null
  const musicVideoGateEnabled =
    params.session.spec.meta.audio_source === 'user_audio' &&
    params.session.spec.meta.music_video_improvement_enabled === true
  const scriptHash = hashPromptRouteScript(script, originalUserInput, intentMode)
  const cached = params.session.cached_artifacts.prompt_route
  const musicIneligibilityReason = getUipMusicTrackIneligibilityReason(params.session.spec)
  // Single source of truth for which signal carried the music intent --
  // shares the preset > planner > detector precedence with the
  // musicSignalSource attribution.
  const musicSignalSource = getUipMusicSignalSource(params.session.spec)
  if (hasUipMusicSignal(params.session.spec) && musicIneligibilityReason === null) {
    const artifact = buildPromptRouteArtifact({
      effectivePromptRoute: musicVideoGateEnabled ? 'music' : 'general',
      gateEnabled,
      musicVideoGateEnabled,
      promptRoute: 'music',
      reasoning:
        musicSignalSource === 'preset'
          ? 'Session created via the song-to-video entry (is_music preset), so the music route was selected.'
          : musicSignalSource === 'planner_audio_music'
            ? 'UIP input_type=audio_music, so the music route was selected.'
            : 'Uploaded audio was detected as music (audio_is_music), so the music route was selected.',
      scriptHash,
    })
    params.session.cached_artifacts.prompt_route = artifact
    return artifact
  }
  if (
    cached &&
    cached.script_hash === scriptHash &&
    cached.gate_enabled === gateEnabled &&
    (cached.music_video_improvement_enabled ?? false) === musicVideoGateEnabled &&
    (gateEnabled || isUipPromptRoute(cached.effective_prompt_route)) &&
    isUipPromptRoute(cached.prompt_route)
  ) {
    const artifact = applyModeBoundaryToArtifact({ artifact: cached, intentMode })
    if (artifact !== cached) {
      params.session.cached_artifacts.prompt_route = artifact
    }
    return artifact
  }

  const { artifact, cacheable } = await classifyPromptRoute({
    gateEnabled,
    intentMode,
    modelSelectorTier: params.session.modelSelectorTier,
    musicVideoGateEnabled,
    originalUserInput,
    projectId: params.session.sessionId,
    script,
    scriptHash,
  })

  if (cacheable && isUipPromptRoute(artifact.prompt_route)) {
    params.session.cached_artifacts.prompt_route = artifact
  }
  return artifact
}

function applyModeBoundaryToArtifact(params: {
  artifact: PromptRouteArtifact
  intentMode?: Mode | null
}): PromptRouteArtifact {
  if (!params.intentMode) {
    return params.artifact
  }
  if (params.artifact.prompt_route === 'music' && params.intentMode !== 'ads') {
    return params.artifact
  }
  const intentMode = params.intentMode

  if (intentMode === 'narrative_story') {
    return coerceDisallowedArtifactRouteToGeneral(
      { artifact: params.artifact, intentMode },
      (route) => route === 'general',
    )
  }
  if (intentMode === 'explainer') {
    return coerceDisallowedArtifactRouteToGeneral(
      { artifact: params.artifact, intentMode },
      (route) => route === 'abstract' || route === 'general',
    )
  }
  if (intentMode === 'ads') {
    return coerceDisallowedArtifactRouteToGeneral(
      { artifact: params.artifact, intentMode },
      (route) => route !== 'abstract' && route !== 'music',
    )
  }
  return params.artifact
}

function buildPromptRouteArtifact(params: {
  effectivePromptRoute?: UipPromptRoute
  gateEnabled: boolean
  musicVideoGateEnabled?: boolean
  promptRoute: UipPromptRoute
  reasoning: string
  scriptHash: string
}): PromptRouteArtifact {
  return {
    effective_prompt_route:
      params.effectivePromptRoute ??
      (params.promptRoute === 'music'
        ? params.musicVideoGateEnabled === true
          ? 'music'
          : 'general'
        : params.gateEnabled
          ? params.promptRoute
          : 'general'),
    gate_enabled: params.gateEnabled,
    generated_at: new Date().toISOString(),
    music_video_improvement_enabled: params.musicVideoGateEnabled,
    prompt_route: params.promptRoute,
    reasoning: params.reasoning,
    script_hash: params.scriptHash,
  }
}

async function classifyPromptRoute(params: {
  gateEnabled: boolean
  intentMode?: Mode | null
  /** Quality tier for model routing. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  musicVideoGateEnabled: boolean
  originalUserInput?: string
  projectId: string
  script: string
  scriptHash: string
}): Promise<{ artifact: PromptRouteArtifact; cacheable: boolean }> {
  if (!params.script) {
    return {
      artifact: buildPromptRouteArtifact({
        gateEnabled: params.gateEnabled,
        musicVideoGateEnabled: params.musicVideoGateEnabled,
        promptRoute: 'general',
        reasoning: 'No confirmed script was available, so the general route was used.',
        scriptHash: params.scriptHash,
      }),
      cacheable: true,
    }
  }

  const startedAt = Date.now()
  const prompt = buildUipPromptRouteClassificationPrompt(
    params.script,
    params.originalUserInput,
    params.intentMode,
  )
  logger.info(
    `[uip-prompt-route] start projectId=${params.projectId} scriptChars=${params.script.length} originalUserInputChars=${
      params.originalUserInput?.length ?? 0
    } gateEnabled=${params.gateEnabled}`,
  )

  try {
    const result = await completion({
      models: PLANNER_TOOL_MODELS,
      prompt,
      reasoningEffort: 'low',
      responseFormat: PromptRouteClassificationSchema,
      task: 'user-intent-planner-prompt-route-classification',
      temperature: 0,
      timeout: 60_000,
    })

    logger.info(
      `[uip-prompt-route] done projectId=${params.projectId} durationMs=${Date.now() - startedAt} route=${result.prompt_route} effectiveRoute=${
        result.prompt_route === 'music'
          ? params.musicVideoGateEnabled
            ? 'music'
            : 'general'
          : params.gateEnabled
            ? result.prompt_route
            : 'general'
      }`,
    )

    return {
      artifact: applyModeBoundaryToArtifact({
        artifact: buildPromptRouteArtifact({
          gateEnabled: params.gateEnabled,
          effectivePromptRoute:
            result.prompt_route === 'music'
              ? params.musicVideoGateEnabled
                ? 'music'
                : 'general'
              : params.gateEnabled
                ? result.prompt_route
                : 'general',
          musicVideoGateEnabled: params.musicVideoGateEnabled,
          promptRoute: result.prompt_route,
          reasoning:
            params.gateEnabled === true
              ? result.reasoning?.trim() || 'Route classification completed.'
              : `${result.reasoning?.trim() || 'Route classification completed.'} improved_visual_script gate disabled; downstream uses general route.`,
          scriptHash: params.scriptHash,
        }),
        intentMode: params.intentMode,
      }),
      cacheable: true,
    }
  } catch (err) {
    logger.warn(
      `[uip-prompt-route] failed projectId=${params.projectId} durationMs=${Date.now() - startedAt} err=${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return {
      artifact: buildPromptRouteArtifact({
        gateEnabled: params.gateEnabled,
        musicVideoGateEnabled: params.musicVideoGateEnabled,
        promptRoute: 'general',
        reasoning: 'LLM route classification failed, so the general route was used as fallback.',
        scriptHash: params.scriptHash,
      }),
      cacheable: false,
    }
  }
}

function coerceDisallowedArtifactRouteToGeneral(
  params: {
    artifact: PromptRouteArtifact
    intentMode: Mode
  },
  isAllowed: (route: UipPromptRoute) => boolean,
): PromptRouteArtifact {
  const effectivePromptRoute = params.artifact.effective_prompt_route
  const promptRoute = isAllowed(params.artifact.prompt_route)
    ? params.artifact.prompt_route
    : 'general'
  const effectiveRoute =
    effectivePromptRoute && isAllowed(effectivePromptRoute) ? effectivePromptRoute : 'general'
  if (
    promptRoute === params.artifact.prompt_route &&
    effectiveRoute === params.artifact.effective_prompt_route
  ) {
    return params.artifact
  }

  return {
    ...params.artifact,
    effective_prompt_route: effectiveRoute,
    prompt_route: promptRoute,
    reasoning: `${params.artifact.reasoning} Overridden to general because UIP mode is ${params.intentMode} and the route is outside the allowed route set for that confirmed mode.`,
  }
}
