export type SharedArtifactBatchContext = {
  /** Commit a provisional refinement FULL anchor rebuild after both batch arms succeed. */
  deferredAnchorCommit?: () => Promise<void>
  /** Bypass the persisted canonical plan for a ledger-driven refinement rebuild. */
  forceFreshAnchorPlan?: boolean
  // When true, the first arm to reach `ensureWorldBible` regenerates the
  // world-bible canon (ignores the persisted artifact); the other arm then
  // reuses the freshly-computed result via `withSharedArtifactResult`. The
  // anchor_vs_batch tool seeds it from the VS call's `refresh_world_bible`
  // param before the arms run; undefined = no forced refresh.
  forceWorldBibleRefresh?: boolean
  inflight: Map<string, Promise<unknown>>
  resolved: Map<string, unknown>
  /** Delete provisional image objects when the atomic rebuild rolls back. */
  rollbackAnchorRebuild?: () => Promise<void>
}

export const ANCHOR_ASSETS_TOOL_PARAMS_BATCH_KEY = 'anchor_assets_tool_params'

const sharedArtifactBatchContextByRuntime = new WeakMap<object, SharedArtifactBatchContext>()

export function clearSharedArtifactBatchContext(runtime: object): void {
  sharedArtifactBatchContextByRuntime.delete(runtime)
}

export function createSharedArtifactBatchContext(): SharedArtifactBatchContext {
  return {
    inflight: new Map(),
    resolved: new Map(),
  }
}

export function getSharedArtifactBatchContext(runtime: object): null | SharedArtifactBatchContext {
  return sharedArtifactBatchContextByRuntime.get(runtime) ?? null
}

export function setSharedArtifactBatchContext(
  runtime: object,
  context: SharedArtifactBatchContext,
): void {
  sharedArtifactBatchContextByRuntime.set(runtime, context)
}

export async function withSharedArtifactResult<T>(
  context: null | SharedArtifactBatchContext,
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  if (!context) {
    return factory()
  }

  const resolved = context.resolved.get(key)
  if (resolved !== undefined) {
    return resolved as T
  }

  const inflight = context.inflight.get(key)
  if (inflight) {
    return (await inflight) as T
  }

  const task = factory()
  context.inflight.set(key, task as Promise<unknown>)
  try {
    const result = await task
    context.resolved.set(key, result)
    return result
  } finally {
    context.inflight.delete(key)
  }
}
