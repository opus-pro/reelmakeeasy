/** The four user-visible artifacts the ledger tracks. */
export type ArtifactId = 'anchor_bindings' | 'global_constraints' | 'script' | 'visual_script'

/** How a stale entry is discharged. `patch` costs nothing; `tool` costs an LLM call. */
export type EdgeTier = 'patch' | 'tool'

/**
 * Guidance surfaced to the planner, NOT a contract. `mandatory` means cascade
 * without asking the user; `confirm` means ask first. Both accept a reasoned
 * dismissal; there is deliberately no non-dismissible tier.
 */
export type EdgeUrgency = 'confirm' | 'mandatory'

export interface StaleEntry {
  artifact: ArtifactId
  /** Patch-tier only: paths whose value must change to discharge this entry. */
  discharge_paths?: string[]
  dismiss_reason?: string
  dismissed_at?: string
  /**
   * The dependent artifact did not exist when this entry was marked, so whatever
   * produces it builds it fresh from current state. Such an entry is discharged
   * by ANY production of the artifact, ignoring `required_params` -- that gate
   * exists to stop a partial edit discharging a broad staleness, not to stop a
   * first build.
   */
  marked_while_absent?: boolean
  /** Params the discharging call must carry, or the discharge does not count. */
  required_params?: Record<string, unknown>
  since: string
  /**
   * What the edit that marked this entry actually changed, as
   * `describeSourceDelta` renders it. Only set for sources whose change is
   * observable at mark time; bounded by MAX_SOURCE_DELTA_CHARS so a wholesale
   * rewrite degrades to counts rather than storing a second copy of the source.
   */
  source_change?: string
  source_path: string
  tier: EdgeTier
  urgency: EdgeUrgency
}
