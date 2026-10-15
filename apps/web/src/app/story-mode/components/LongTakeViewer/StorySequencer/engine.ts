import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import type { LongTakeTransition } from '@shared/types/api/long-take'

import type { StorySegment, StoryTransitionSegment } from '@/app/story-mode/long-take.types'

export type LipSyncPreviewSnapshot = {
  lipSyncDisabledTransitionCount: number
  lipSyncEnabledTransitionCount: number
  lipSyncGenerated: boolean
  lipSyncGeneratedTransitionCount: number
  projectLipSyncEnabled: boolean
}

export function applyLipSyncPreviewOverridesToTransitions(
  transitions: LongTakeTransition[],
  overrides?: Record<string, boolean>,
): LongTakeTransition[] {
  return transitions.map((transition) => {
    if (!hasLipSyncPreviewVariant(transition)) {
      return transition
    }
    const lipSyncEnabled = resolveTransitionLipSyncPreviewEnabled(transition, overrides)
    return transition.lipSyncEnabled === lipSyncEnabled
      ? transition
      : { ...transition, lipSyncEnabled }
  })
}

/** State stores media as storage paths; segments are rendered, so they carry URLs. */
export function buildSegments(
  transitions: LongTakeTransition[],
  keyframeMap: Record<string, { keyframeUrl: string; thumbnailUrl?: string }>,
  audioDurationMs: number,
  options?: { lipSyncPreviewOverrides?: Record<string, boolean> },
): StorySegment[] {
  if (transitions.length === 0) {
    return []
  }

  const sorted = [...transitions].sort((a, b) => a.startMs - b.startMs)
  const segments: StorySegment[] = []

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]
    const shotStartMs = i === 0 ? 0 : sorted[i - 1].endMs
    const fromKf = keyframeMap[t.fromShotId]
    segments.push(
      {
        kind: 'keyframe',
        shotId: t.fromShotId,
        keyframeUrl: mediaUrl(fromKf?.keyframeUrl ?? ''),
        thumbnailUrl: mediaUrl(fromKf?.thumbnailUrl),
        startMs: shotStartMs,
        endMs: t.startMs,
      },
      {
        kind: 'transition',
        transitionId: t.transitionId,
        baseVideoUri: mediaUrl(t.baseVideoUri),
        lipSyncEnabled: t.lipSyncEnabled,
        lipSyncVideoUri: mediaUrl(t.lipSyncVideoUri),
        videoUri: mediaUrl(resolveTransitionPreviewVideoUri(t, options?.lipSyncPreviewOverrides)),
        startMs: t.startMs,
        endMs: t.endMs,
        videoWidth: t.videoWidth,
        videoHeight: t.videoHeight,
      },
    )
  }

  const last = sorted[sorted.length - 1]
  const lastKf = keyframeMap[last.toShotId]
  segments.push({
    kind: 'keyframe',
    shotId: last.toShotId,
    keyframeUrl: mediaUrl(lastKf?.keyframeUrl ?? ''),
    thumbnailUrl: mediaUrl(lastKf?.thumbnailUrl),
    startMs: last.endMs,
    endMs: audioDurationMs,
  })

  return segments
}

export function getLipSyncPreviewTransitions(
  transitions: LongTakeTransition[],
): Array<LongTakeTransition & { baseVideoUri: string; lipSyncVideoUri: string }> {
  return transitions.filter(hasLipSyncPreviewVariant)
}

export function getSegmentAt<T extends StorySegment>(
  segments: T[],
  currentMs: number,
): [null | T, number] {
  if (segments.length === 0) {
    return [null, -1]
  }

  let lo = 0
  let hi = segments.length - 1

  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const seg = segments[mid]
    if (currentMs < seg.startMs) {
      hi = mid - 1
    } else if (currentMs >= seg.endMs) {
      lo = mid + 1
    } else {
      return [seg, mid]
    }
  }

  return [segments[Math.max(0, hi)], Math.max(0, hi)]
}

export function getTotalDurationMs(segments: StorySegment[]): number {
  if (segments.length === 0) {
    return 0
  }
  return segments[segments.length - 1].endMs
}

export function hasLipSyncPreviewExportChanges(
  baseTransitions: LongTakeTransition[],
  exportTransitions: LongTakeTransition[],
): boolean {
  const baseById = new Map(
    baseTransitions.map((transition) => [transition.transitionId, transition]),
  )
  const exportIds = new Set<string>()

  for (const transition of exportTransitions) {
    exportIds.add(transition.transitionId)
    const base = baseById.get(transition.transitionId)
    if (!base) {
      if (hasLipSyncPreviewVariant(transition)) {
        return true
      }
      continue
    }
    if (!hasLipSyncPreviewVariant(base) && !hasLipSyncPreviewVariant(transition)) {
      continue
    }
    if (
      resolveTransitionLipSyncPreviewEnabled(base) !==
      resolveTransitionLipSyncPreviewEnabled(transition)
    ) {
      return true
    }
  }

  for (const base of baseTransitions) {
    if (!exportIds.has(base.transitionId) && hasLipSyncPreviewVariant(base)) {
      return true
    }
  }

  return false
}

export function hasLipSyncPreviewVariant<
  T extends null | Pick<LongTakeTransition, 'baseVideoUri' | 'lipSyncVideoUri'> | undefined,
>(transition: T): transition is NonNullable<T> & { baseVideoUri: string; lipSyncVideoUri: string } {
  return Boolean(transition?.baseVideoUri && transition.lipSyncVideoUri)
}

export function resolveActiveLipSyncPreviewTransition(params: {
  activeShotId?: null | string
  activeTransitionId?: null | string
  transitions: LongTakeTransition[]
}): LongTakeTransition | null {
  const { activeShotId, activeTransitionId, transitions } = params
  if (activeTransitionId) {
    const transition = transitions.find((item) => item.transitionId === activeTransitionId) ?? null
    if (hasLipSyncPreviewVariant(transition)) {
      return transition
    }
  }

  if (!activeShotId) {
    return null
  }

  return (
    transitions.find(
      (transition) =>
        transition.fromShotId === activeShotId && hasLipSyncPreviewVariant(transition),
    ) ?? null
  )
}

export function resolveActiveTransitionId(
  segment: null | StoryTransitionSegment | undefined,
  currentMs: number,
): null | string {
  if (!segment || !Number.isFinite(currentMs)) {
    return null
  }
  return currentMs >= segment.startMs && currentMs < segment.endMs ? segment.transitionId : null
}

export function resolveAnyLipSyncPreviewEnabled(
  transitions: LongTakeTransition[],
  overrides?: Record<string, boolean>,
): boolean {
  return resolveLipSyncPreviewSnapshot(transitions, overrides).projectLipSyncEnabled
}

export function resolveLipSyncPreviewSnapshot(
  transitions: LongTakeTransition[],
  overrides?: Record<string, boolean>,
): LipSyncPreviewSnapshot {
  const lipSyncTransitions = getLipSyncPreviewTransitions(transitions)
  const lipSyncEnabledTransitionCount = lipSyncTransitions.filter((transition) =>
    resolveTransitionLipSyncPreviewEnabled(transition, overrides),
  ).length
  const lipSyncGeneratedTransitionCount = lipSyncTransitions.length

  return {
    lipSyncDisabledTransitionCount: lipSyncGeneratedTransitionCount - lipSyncEnabledTransitionCount,
    lipSyncEnabledTransitionCount,
    lipSyncGenerated: lipSyncGeneratedTransitionCount > 0,
    lipSyncGeneratedTransitionCount,
    projectLipSyncEnabled: lipSyncEnabledTransitionCount > 0,
  }
}

export function resolveTransitionLipSyncPreviewEnabled(
  transition:
    | null
    | Pick<
        LongTakeTransition,
        'baseVideoUri' | 'lipSyncEnabled' | 'lipSyncVideoUri' | 'transitionId'
      >
    | undefined,
  overrides?: Record<string, boolean>,
): boolean {
  if (!hasLipSyncPreviewVariant(transition)) {
    return false
  }
  const override = transition?.transitionId ? overrides?.[transition.transitionId] : undefined
  return override ?? transition?.lipSyncEnabled ?? true
}

export function resolveTransitionPreviewVideoUri(
  transition: Pick<
    LongTakeTransition,
    'baseVideoUri' | 'lipSyncEnabled' | 'lipSyncVideoUri' | 'transitionId' | 'videoUri'
  >,
  overrides?: Record<string, boolean>,
): string {
  if (!hasLipSyncPreviewVariant(transition)) {
    return transition.videoUri
  }
  return resolveTransitionLipSyncPreviewEnabled(transition, overrides)
    ? transition.lipSyncVideoUri || transition.videoUri
    : transition.baseVideoUri || transition.videoUri
}

function mediaUrl<T extends string | undefined>(uri: T): T {
  return (uri ? storeUriToUrl(uri) : uri) as T
}
