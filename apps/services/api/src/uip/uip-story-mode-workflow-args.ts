import type { Prisma } from '@reelmakeeasy/api-db'
import { sanitizeGenerationResolution } from '@reelmakeeasy/common/model-config/story-mode-generation-resolution-config.zod'
import type { Spec } from '@reelmakeeasy/uip-planner-runtime'

import { extractBrandDomain } from './uip-confirm-orchestration'
import { extractDebugModelSwitch } from './uip-debug-settings'
import {
  resolveUipMusicIntent,
  resolveUipMusicRouteIneligibleReason,
  resolveUipMusicSignalSource,
} from './uip-music-intent.util'
import { stripInlineTtsMarkupForDisplay } from './uip-planner-utils'

/**
 * Everything the argument object reads. Named after the locals it was extracted
 * from so the move stays reviewable against the original.
 *
 * The confirm-runtime fields (`admissionTier`, the telemetry counts, the
 * voiceover handoffs) are optional: they exist only on a real confirm, and a
 * caller that has no admission decision to report should say so by omission
 * rather than by inventing a value.
 */
export interface BuildUipToStoryModeWorkflowArgsInput {
  admissionTier?: unknown
  displayScript?: string
  effectivePromptRoute?: unknown
  generatedAnchorCounts?: unknown
  keyframeImageModel?: unknown
  longVideoAttemptSource?: unknown
  nstInputs: {
    genreAnalysis?: unknown
    intentAnalysis?: unknown
    styleReferenceImageUrls?: unknown
  }
  numAssetMentions?: unknown
  originalUserInput?: string
  previewVoiceover?: null | { audio_path: string; script_text: string }
  preVoiceover?: unknown
  project: Prisma.ProjectGetPayload<object>
  projectId: string
  projectOrgId?: null | string
  promptRouteArtifact?: null | {
    classified_route?: null | string
    gate_enabled?: boolean
    prompt_route?: null | string
  }
  requestedDurationSeconds?: unknown
  reusableStylePrompt?: unknown
  script: string
  shotCount: number
  spec: Spec
  styleAnalysis?: unknown
  uipSession: Prisma.UipSessionGetPayload<object>
  userAssetCatalog?: unknown
  visualScriptStorePath: string
}

/**
 * Build the argument object handed to the Story Mode render workflow at confirm.
 *
 * Moved verbatim out of `executeConfirmOrchestration` so the Story Mode 3.0
 * playground starts the SAME render with the SAME configuration. Hand-picking a
 * few fields there produced a run with no style, no voice, no prompt route and
 * no brand context -- a comparison whose differences said more about the
 * playground than about the pipeline it was meant to evaluate.
 *
 * Pure: every value comes from `input`. The session lock and the admission
 * lookup stay with the caller.
 */
export function buildUipToStoryModeWorkflowArgs(
  input: BuildUipToStoryModeWorkflowArgsInput,
): Record<string, unknown> {
  const {
    admissionTier,
    displayScript,
    effectivePromptRoute,
    generatedAnchorCounts,
    keyframeImageModel,
    longVideoAttemptSource,
    nstInputs,
    numAssetMentions,
    originalUserInput,
    promptRouteArtifact,
    preVoiceover,
    previewVoiceover,
    project,
    projectId,
    projectOrgId,
    requestedDurationSeconds,
    reusableStylePrompt,
    script,
    shotCount,
    spec,
    styleAnalysis,
    uipSession,
    userAssetCatalog,
    visualScriptStorePath,
  } = input
  return {
    projectId,
    userId: project.owner ?? '',
    userEmail: project.ownerEmail ?? undefined,
    script: displayScript || script,
    visualScriptPath: visualScriptStorePath,
    visualScriptItemCount: shotCount,
    styleName: spec.global_constraints.style.style_name || undefined,
    styleText: spec.global_constraints.style.style_text || undefined,
    // Auto Style Selection provenance: tracking-only, stamped on
    // `project.long_take.completed` so a finished run records where
    // its style came from.
    //
    // Defaulted to 'manual': only the agent path ever WRITES
    // style_source ('auto' from select_auto_style / the empty-style
    // fallback, 'auto_switched' from a rail switch), so everything
    // else in a UIP session is a user-owned style -- an upfront
    // pick, a brand-provided look (brand_style_directive 'hybrid',
    // which suppresses the auto pick by design), or a legacy
    // no-pick default. Omitting the property instead would leave
    // every one of those in one unreadable `undefined` bucket.
    styleSource: spec.global_constraints.style_source ?? 'manual',
    selectionMethod: spec.global_constraints.selection_method,
    // The agent's ranked candidate set (top pick first), as style
    // names -- paired with the shipped styleName it yields decision
    // quality (in-set rank vs off-list) on completed.
    styleCandidates: spec.global_constraints.style_candidates?.map(
      (candidate) => candidate.style_name,
    ),
    // Forward the NST-derived style analysis so
    // `UipToStoryModeWorkflow` can plumb it into pipeline context
    // and use `reusable_prompt` as the keyframe / transition
    // styleText. Populated by the chained `analyze_style` step
    // inside `generate_intent_context` when a style image was
    // provided. Both fields are undefined for sessions that
    // never ran style analysis -- the workflow falls back to the
    // raw `styleText` in that case.
    reusableStylePrompt,
    styleAnalysis,
    // UIP-derived intent / genre / reference URLs.
    intentAnalysis: nstInputs.intentAnalysis,
    genreAnalysis: nstInputs.genreAnalysis,
    styleReferenceImageUrls: nstInputs.styleReferenceImageUrls,
    improvedVisualScriptEnabled: promptRouteArtifact?.gate_enabled,
    originalUserInput,
    promptRoute: effectivePromptRoute,
    promptRouteClassified: promptRouteArtifact?.prompt_route,
    uipMode: spec.meta.mode_state?.mode,
    // Strong music intent from either the song-to-video entry preset
    // or the UIP planner's audio_music classification. Lets the
    // workflow build a music beat sheet without depending solely on
    // the later audio-verdict classifier; gate + beat-sheet guards
    // still apply downstream.
    isMusic: resolveUipMusicIntent(spec),
    musicRouteIneligibleReason: resolveUipMusicRouteIneligibleReason(spec) ?? undefined,
    // Which signal carried the music intent (preset / planner /
    // content detector / none) -- tracking-only attribution for
    // the routing-quality panel.
    musicSignalSource: resolveUipMusicSignalSource(spec),
    preVoiceover,
    previewVoiceover: previewVoiceover
      ? {
          audioPath: previewVoiceover.audio_path,
          scriptText:
            stripInlineTtsMarkupForDisplay(previewVoiceover.script_text) || displayScript || script,
          source: 'tts_preview',
        }
      : undefined,
    requestedDurationSeconds:
      typeof requestedDurationSeconds === 'number' &&
      Number.isFinite(requestedDurationSeconds) &&
      requestedDurationSeconds > 0
        ? requestedDurationSeconds
        : undefined,
    aspectRatio: uipSession.aspectRatio ?? undefined,
    voiceId: uipSession.voiceId ?? undefined,
    keyframeImageModel,
    generationResolution: sanitizeGenerationResolution(uipSession.generationResolution),
    imageModel: uipSession.imageModel ?? undefined,
    modelSelectorTier: uipSession.modelSelectorTier ?? undefined,
    orgId: projectOrgId || undefined,
    transitionVideoModel: uipSession.transitionVideoModel ?? undefined,
    // Debug panel model switch persisted at session creation.
    // Threaded to the transition stage so getModelName
    // honors the `video-generate` override in the UIP path, matching
    // the classic create flow. undefined for normal users.
    debugSettings: extractDebugModelSwitch(project.debugSettings),
    admissionTier,
    // Brand metadata for downstream tracking. Opaque
    // pass-through; nothing in this workflow currently reads
    // these fields.
    isBrandProject: spec.global_constraints.brand_bank != null,
    brandDomain: extractBrandDomain(spec.global_constraints.brand_extraction_input),
    // In-session extraction OR a saved brief applied from the
    // brand library (which leaves brand_extraction_input null).
    isBrandVideo:
      spec.global_constraints.brand_extraction_input != null ||
      spec.global_constraints.brand_bank_source != null,
    uipUserWebsite:
      spec.global_constraints.brand_extraction_input?.kind === 'url'
        ? spec.global_constraints.brand_extraction_input.url
        : null,
    uipUserBrandDescription:
      spec.global_constraints.brand_extraction_input?.kind === 'freeform'
        ? spec.global_constraints.brand_extraction_input.text
        : null,
    numBrandfilesUploaded:
      (
        uipSession.state as null | {
          brand_telemetry?: { files_uploaded_count?: number }
        }
      )?.brand_telemetry?.files_uploaded_count ?? 0,
    // Tracking-only metadata for `project.long_take.completed`
    // parity with classic; not consumed by any pipeline stage.
    customStyle: uipSession.customStyle ?? false,
    userAssetCatalog,
    generatedAnchorCounts,
    numAssetMentions,
    longVideoAttemptSource,
    enableCaption: project.enableCaption ?? null,
    // Per-project BGM toggle persisted on the Project row
    // at creation. Omitted when null (projects predating
    // the toggle) so old-input replays schedule no BGM commands --
    // the same omit-when-null semantics as the classic route's
    // buildBgmFlagWorkflowArgs.
    ...(project.bgmEnabled == null ? {} : { bgmEnabled: project.bgmEnabled }),
  }
}
