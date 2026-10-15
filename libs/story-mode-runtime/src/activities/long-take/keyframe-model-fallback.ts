/**
 * Cross-model fallback awareness for keyframe generation.
 *
 * When the primary image model is exhausted the orchestrator silently retries
 * the attempt against a substitute model. The substitute receives the same
 * anchor images but does not honour the primary's stylization, so it renders a
 * different-looking character in a different art style. None of the keyframe
 * quality checks (reframe / upside-down / gibberish) can see that, so the
 * substitution has to be detected by model identity instead.
 */
import { normalizeImageModelId, resolveImageProvider } from '@reelmakeeasy/common/llm'

import { PHOTO_PASSTHROUGH_IMAGE_MODEL } from '../../workflows/long-take/photo-passthrough'
import { resolveBreakerScope, storyModeBreaker } from '../circuit-breaker'

import { formatError, formatLogFields, logger } from './common'
import { isCleanCandidate } from './keyframes-recovery'

export const LOGO_PASSTHROUGH_IMAGE_MODEL = 'logo-passthrough'

/** Single extra attempt granted when the only candidate came from a substitute model. */
export const PRIMARY_MODEL_RETRY_ATTEMPT = 2

/** Composited from a supplied asset, so they carry no generation model of their own. */
const PASSTHROUGH_IMAGE_MODELS: ReadonlySet<string> = new Set([
  LOGO_PASSTHROUGH_IMAGE_MODEL,
  PHOTO_PASSTHROUGH_IMAGE_MODEL,
])

export type KeyframeCandidateQuality = {
  attempt: number
  hasGibberish?: boolean | null
  imageModel?: string
  reframe?: boolean | null
  textIssue?: boolean | null
  upsideDown?: boolean | null
}

/** Undefined on the gate-off path, where no selected model is in play. */
export function resolvePrimaryModel(
  useSelectedModel: boolean,
  selectedModel: string | undefined,
): string | undefined {
  return useSelectedModel && selectedModel ? normalizeImageModelId(selectedModel) : undefined
}

/**
 * primaryModel is undefined on the gate-off path, where no selected model is in
 * play; every candidate then counts as primary and selection stays unchanged.
 */
export function isPrimaryModelCandidate(
  candidate: { imageModel?: string },
  primaryModel: string | undefined,
): boolean {
  if (primaryModel === undefined || candidate.imageModel === undefined) {
    return true
  }
  if (PASSTHROUGH_IMAGE_MODELS.has(candidate.imageModel)) {
    return true
  }
  return normalizeImageModelId(candidate.imageModel) === primaryModel
}

export function selectFinalCandidate<T extends KeyframeCandidateQuality>(
  initialCandidate: T,
  rerunCandidates: T[],
  primaryModel?: string,
): T {
  const sortedRerunCandidates = [...rerunCandidates].sort((a, b) => a.attempt - b.attempt)
  const cleanCandidates = sortedRerunCandidates.filter((candidate) => isCleanCandidate(candidate))
  // Attempts run concurrently, so attempt order is dispatch order, not quality
  // order. Preferring the primary model keeps a lower-numbered fallback result
  // from beating a clean primary one.
  const cleanPrimaryCandidate = cleanCandidates.find((candidate) =>
    isPrimaryModelCandidate(candidate, primaryModel),
  )
  return cleanPrimaryCandidate ?? cleanCandidates[0] ?? initialCandidate
}

/**
 * Read-only breaker probe. getSnapshot is used rather than check() so this does
 * not consume a half-open probe slot; anything but a closed breaker means the
 * provider is already shedding load, and the quota exhaustion that caused the
 * fallback must not be amplified by an extra attempt.
 */
async function isPrimaryProviderHealthy(primaryModel: string): Promise<boolean> {
  try {
    const snapshot = await storyModeBreaker.getSnapshot(
      `${resolveBreakerScope()}:${resolveImageProvider(primaryModel)}`,
    )
    return snapshot.state === 'closed'
  } catch {
    return false
  }
}

/**
 * One extra attempt against the primary model, for a shot whose only candidate
 * came back from a substitute model. Returns undefined when the retry is
 * skipped (breaker not closed) or fails, so the caller keeps the candidate it
 * already has and a shot is never lost to this path.
 */
async function generatePrimaryModelRetryCandidate<T>(params: {
  generateCandidate: (attempt: number) => Promise<T>
  primaryModel: string | undefined
  projectId: string
  shotId: string
}): Promise<T | undefined> {
  const { generateCandidate, primaryModel, projectId, shotId } = params
  if (primaryModel === undefined || !(await isPrimaryProviderHealthy(primaryModel))) {
    return undefined
  }

  // The retry's own "attempt completed" line already reports its imageModel and
  // quality flags, so only the failure path needs a log of its own here.
  try {
    return await generateCandidate(PRIMARY_MODEL_RETRY_ATTEMPT)
  } catch (error) {
    logger.warn(
      `[long-take] Keyframe primary-model retry failed ${formatLogFields({
        projectId,
        shotId,
        primaryModel,
        err: formatError(error),
      })}`,
    )
    return undefined
  }
}

/**
 * Decides what a shot ships when its first candidate already passed every
 * quality check. A candidate produced by the primary model is accepted as-is;
 * a substituted one earns a single bounded retry, and only replaces the
 * original when that retry comes back clean AND on the primary model.
 *
 * Returns the full candidate list too, so the caller can clean up the loser.
 */
export async function resolveCleanCandidate<T extends KeyframeCandidateQuality>(params: {
  firstCandidate: T
  generateCandidate: (attempt: number) => Promise<T>
  primaryModel: string | undefined
  projectId: string
  shotId: string
}): Promise<{ candidates: T[]; selectedCandidate: T }> {
  const { firstCandidate, primaryModel } = params
  if (isPrimaryModelCandidate(firstCandidate, primaryModel)) {
    return { candidates: [firstCandidate], selectedCandidate: firstCandidate }
  }

  const retryCandidate = await generatePrimaryModelRetryCandidate(params)
  if (retryCandidate === undefined) {
    return { candidates: [firstCandidate], selectedCandidate: firstCandidate }
  }

  const retryIsBetter =
    isCleanCandidate(retryCandidate) && isPrimaryModelCandidate(retryCandidate, primaryModel)
  return {
    candidates: [firstCandidate, retryCandidate],
    selectedCandidate: retryIsBetter ? retryCandidate : firstCandidate,
  }
}
