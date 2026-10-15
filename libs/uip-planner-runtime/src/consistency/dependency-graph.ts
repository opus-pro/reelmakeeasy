import type { ArtifactId, EdgeTier, EdgeUrgency } from './ledger-types'

export interface ConsistencyEdge {
  dependent: ArtifactId
  /**
   * For a `patch`-tier edge: the spec paths whose VALUE must change for the
   * entry to be discharged. A tool-tier edge leaves this undefined and is
   * discharged by `tool_completed` instead.
   */
  dischargePaths?: readonly string[]
  /** Realization params the discharge must carry (scope-aware clear). */
  requiredParams?: Readonly<Record<string, unknown>>
  source: string
  tier: EdgeTier
  urgency: EdgeUrgency
}

const BRIEF_SIBLINGS: readonly string[] = [
  'global_constraints.key_entities',
  'global_constraints.geo_scope',
  'global_constraints.time_scope',
  'global_constraints.brand_scope',
  'global_constraints.target_audience',
]

/**
 * The brief fields an INTENT change can invalidate.
 *
 * Deliberately not BRIEF_SIBLINGS. Those are derived from the SUBJECT, so a
 * topic change ages them. A directives / must_not_violate change carries
 * audience and register intent instead: "make it for ten-year-olds" should move
 * target_audience and tone, and must not touch key_entities or geo_scope, which
 * the new instruction says nothing about.
 *
 * `tone` belongs here and NOT in BRIEF_SIBLINGS, for two independent reasons.
 * Semantically it is not subject-derived -- "informative, engaging, and clear"
 * does not go stale when the subject moves from the sea to fintech.
 * Mechanically, clearStaleByPatch discharges on ANY listed path, so adding tone
 * to the sibling list would let the planner clear a whole topic cascade by
 * writing tone alone, leaving key_entities on the old subject.
 */
const INTENT_DEPENDENT_BRIEF_FIELDS: readonly string[] = [
  'global_constraints.target_audience',
  'global_constraints.tone',
]

/**
 * Brief fields the world bible consumes as context or explicit user constraints.
 * Its reuse path does NOT recompute them, so a storyboard refresh for one must carry
 * `refresh_world_bible` or it rebuilds against the old canon.
 */
const WORLD_BIBLE_FIELDS: readonly string[] = [
  'global_constraints.topic',
  'global_constraints.video_type',
  'global_constraints.script_category',
  'global_constraints.key_entities',
  'global_constraints.geo_scope',
  'global_constraints.time_scope',
  'global_constraints.brand_scope',
  'global_constraints.tone',
  'global_constraints.directives',
  'global_constraints.must_not_violate',
]

/**
 * Ledger source key for the script as it exists BEFORE refinement, in
 * `cached_artifacts.working_script.script`.
 *
 * Deliberately not a spec path, because there is no spec path to use. The
 * pre-refinement script has no spec address at all and no spec shadow to key on
 * either -- unlike anchors, which are keyed on
 * `visual_script.shots.pre_selected_assets`, a shadow that exists because shots
 * do. At `script_review` there are no shots yet, so a shadow cannot be borrowed.
 *
 * Safe as a synthetic key because `source` is opaque everywhere downstream: the
 * graph does a string match (`edgesForPath`), `markStale` carries it into
 * `StaleEntry.source_path` as an upsert key, and `clear.ts` never reads
 * `source_path` at all -- discharge is driven by `dischargePaths`,
 * `required_params` and the artifact id, all of which stay real spec paths.
 */
export const WORKING_SCRIPT_SOURCE_PATH = 'cached_artifacts.working_script.script'

/** Brief fields whose change invalidates the script and the storyboard. */
const BRIEF_CONTENT_FIELDS: readonly string[] = [
  'global_constraints.topic',
  'global_constraints.video_type',
  'global_constraints.script_category',
  'global_constraints.key_entities',
  'global_constraints.geo_scope',
  'global_constraints.time_scope',
  'global_constraints.brand_scope',
  'global_constraints.target_audience',
  'global_constraints.tone',
  'global_constraints.directives',
  'global_constraints.must_not_violate',
]

/**
 * The static edge table.
 *
 * Style does not invalidate the storyboard, but it does invalidate the rendered
 * appearance of the current anchor set.
 *
 * Anchors are keyed on `visual_script.shots.pre_selected_assets`, their spec
 * shadow -- anchor state itself lives in cached_artifacts and no spec path
 * addresses it.
 */
export const CONSISTENCY_EDGES: readonly ConsistencyEdge[] = Object.freeze([
  {
    dependent: 'visual_script',
    requiredParams: { refresh_beat_sheet: true, scope: 'FULL' },
    source: 'global_constraints.pacing',
    tier: 'tool',
    urgency: 'mandatory',
  } as ConsistencyEdge,
  ...BRIEF_CONTENT_FIELDS.map(
    (source): ConsistencyEdge => ({
      dependent: 'script',
      source,
      tier: 'tool',
      urgency: 'confirm',
    }),
  ),
  ...BRIEF_CONTENT_FIELDS.map(
    (source): ConsistencyEdge => ({
      dependent: 'visual_script',
      // Only the world-bible fields need the canon rebuilt. Requiring it for
      // target_audience -- which the world bible does not consume -- would
      // demand an expensive rebuild that changes nothing,
      // and would stop an otherwise-correct refresh from discharging the entry.
      ...(WORLD_BIBLE_FIELDS.includes(source)
        ? { requiredParams: { refresh_world_bible: true, scope: 'FULL' } }
        : {}),
      source,
      tier: 'tool',
      urgency: 'confirm',
    }),
  ),
  // Intra-brief: the siblings are all derived from the subject.
  {
    dependent: 'global_constraints',
    dischargePaths: BRIEF_SIBLINGS,
    source: 'global_constraints.topic',
    tier: 'patch',
    urgency: 'mandatory',
  } as ConsistencyEdge,
  // Intra-brief, the intent direction. Section 3's policy runs the
  // OTHER way: a brief refresh must never REWRITE directives / must_not_violate,
  // because they are user intent that a change of subject does not void.
  // Nothing in that rule stops them being a SOURCE -- and they are the source
  // the reported symptom is about, because an instruction like "make it for
  // ten-year-olds" restates the audience without ever naming target_audience.
  //
  // confirm, not mandatory: unlike a topic change, an intent change does not
  // make the old audience factually wrong, only possibly superseded.
  ...['global_constraints.directives', 'global_constraints.must_not_violate'].map(
    (source): ConsistencyEdge => ({
      dependent: 'global_constraints',
      dischargePaths: INTENT_DEPENDENT_BRIEF_FIELDS,
      source,
      tier: 'patch',
      urgency: 'confirm',
    }),
  ),
  // Backward: the storyboard drifting from the brief the keyframe prompt reads.
  //
  // Keyed on BOTH the fine and the coarse path on purpose. A shot-level patch
  // emits update_shot_field(audio_vo), but a tool artifact apply -- the dominant
  // storyboard write path -- emits replace_all_shots, which normalises to the
  // collection path. Without the coarse row this edge could never fire from a VS
  // tool run, which is exactly the case symptom 3 is about.
  {
    dependent: 'global_constraints',
    dischargePaths: ['global_constraints.topic', 'global_constraints.key_entities'],
    source: 'visual_script.shots.audio_vo',
    tier: 'patch',
    urgency: 'confirm',
  } as ConsistencyEdge,
  {
    dependent: 'global_constraints',
    dischargePaths: ['global_constraints.topic', 'global_constraints.key_entities'],
    source: 'visual_script.shots',
    tier: 'patch',
    urgency: 'confirm',
  } as ConsistencyEdge,
  // Backward, pre-refinement: the same script -> brief relationship as the
  // audio_vo row above, for the phase where the script still lives in
  // cached_artifacts. Without it a manual script edit at script_review -- the
  // only phase where the transcript editor is reachable -- marks nothing, so the
  // brief keeps describing the old subject however many times the planner wakes.
  {
    dependent: 'global_constraints',
    dischargePaths: ['global_constraints.topic', 'global_constraints.key_entities'],
    source: WORKING_SCRIPT_SOURCE_PATH,
    tier: 'patch',
    urgency: 'confirm',
  } as ConsistencyEdge,
  {
    dependent: 'visual_script',
    source: 'visual_script.shots.audio_vo',
    tier: 'tool',
    urgency: 'confirm',
  } as ConsistencyEdge,
  // Anchor membership follows semantic subject identity, not the coarse shots
  // collection path. Structural DELETE/reorder/merge operations also emit that
  // path while deterministically preserving bindings, so key FULL recovery on
  // the brief fields that actually change the recurring subject set.
  ...['global_constraints.topic', 'global_constraints.key_entities'].map(
    (source): ConsistencyEdge => ({
      dependent: 'anchor_bindings',
      requiredParams: { scope: 'FULL' },
      source,
      tier: 'tool',
      urgency: 'confirm',
    }),
  ),
  {
    dependent: 'anchor_bindings',
    requiredParams: { scope: 'FULL' },
    source: 'visual_script.shots.visual_primary',
    tier: 'tool',
    urgency: 'confirm',
  } as ConsistencyEdge,
  {
    dependent: 'anchor_bindings',
    requiredParams: { scope: 'ANCHOR_IDS' },
    source: 'global_constraints.style',
    tier: 'tool',
    urgency: 'confirm',
  } as ConsistencyEdge,
  {
    dependent: 'anchor_bindings',
    source: 'visual_script.shots.pre_selected_assets',
    tier: 'tool',
    urgency: 'confirm',
  } as ConsistencyEdge,
])

/** Edges invalidated by a change at `path`. Empty for an unmapped path. */
export function edgesForPath(path: string): readonly ConsistencyEdge[] {
  return CONSISTENCY_EDGES.filter((edge) => edge.source === path)
}
