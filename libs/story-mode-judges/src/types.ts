import type { ZodType } from 'zod'

/** A versioned judge configuration for a specific rubric. */
export interface JudgeVersion<TParams = unknown> {
  readonly params: TParams
  readonly rubricId: string
  readonly runner: string
  readonly thresholds: { readonly pass: number }
  readonly version: string
}

/** Standardized result from any judge execution. */
export interface JudgeResult {
  /**
   * Structured findings a rubric wants to hand back, beyond the verdict.
   * Optional and opt-in: a rubric returns it from `mapResult`, and rubrics
   * that have nothing to add omit it.
   */
  readonly details?: Readonly<Record<string, unknown>>
  readonly pass: boolean
  readonly reason: string
  readonly score: number
}

/**
 * What the shot was supposed to be, for rubrics that judge a frame against
 * its intent rather than against the pixels alone.
 *
 * Orientation and reframe need nothing but the image, so they ignore this.
 * A rubric asking "is the text on this prop something we asked for" cannot
 * be expressed without it: there is otherwise nothing to compare against.
 * Optional so every existing runner call and rubric keeps working unchanged.
 *
 * Carries no user-identifiable fields, matching KeyframeSamplingContext.
 */
export interface JudgeContext {
  /** `global_constraints.brand_scope`: the one brand this video may depict. */
  readonly brandScope?: string
  /** `global_constraints.key_entities`: names the script legitimately uses. */
  readonly keyEntities?: readonly string[]
  /** The shot's own prompt, i.e. what this frame was asked to show. */
  readonly shotPrompt?: string
}

/** A runner strategy that executes a judge version against a keyframe. */
export interface JudgeRunner {
  readonly name: string
  run(
    keyframeUrl: string,
    config: JudgeVersion<unknown>,
    context?: JudgeContext,
  ): Promise<JudgeResult>
}

/** Params specific to the gemini-vision runner. */
export interface GeminiVisionParams {
  /**
   * Context-aware prompt builder. When present it replaces `prompt`, so a
   * rubric can name this shot's intent instead of asking a fixed question.
   * `prompt` remains the fallback and is required, which keeps a rubric
   * answerable when the caller supplies no context.
   */
  readonly buildPrompt?: (context: JudgeContext | undefined) => string
  readonly mapResult: (raw: Record<string, unknown>) => {
    details?: Readonly<Record<string, unknown>>
    pass: boolean
  }
  readonly model: string
  readonly prompt: string
  readonly responseSchema: ZodType
  readonly temperature?: number
}

/** Context passed to sampling/shadow logic - no user-identifiable fields. */
export interface KeyframeSamplingContext {
  readonly keyframeUrl: string
  readonly projectId: string
  readonly shotId: string
  readonly style: string
}
