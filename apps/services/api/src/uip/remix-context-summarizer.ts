/**
 * Remix carry-over context summarizer.
 *
 * Builds a short, factual set of bullets describing the genuine decisions
 * the user made in the source project (the one being remixed), for use as
 * planner context on the new UIP session. The bullets are treated by the
 * planner as inheritable defaults the user may override, never as
 * instructions for the new spec.
 *
 * This is fully deterministic (no LLM): a field -> bullet map. That
 * structurally eliminates the truncation the old prose summarizer hit,
 * removes latency/cost, and -- crucially -- only surfaces fields the user
 * actually chose. From `global_constraints` we carry `topic` and
 * `target_audience` -- the direction/angle and audience the user settled
 * during the section 2.5 refinement turn. We still drop the genuinely
 * LLM-inferred rails (tone / pacing / directives / must_not_violate / scopes /
 * key_entities), which are the agent's guesses, not the user's decisions.
 *
 * Source: ONLY a locked UIP spec in storage yields carry-over. Bullets come from
 * `meta.mode_state` + `meta.audio_source` + `global_constraints`
 * (topic / target_audience); we skip `visual_script.shots[]`. Non-UIP sources
 * -- demo projects, legacy projects, anything without a locked spec -- carry
 * NOTHING: there were no genuine planner decisions to inherit, so surfacing
 * `Project.initPrompt` / `script` would be noise, not a real user choice. The
 * earlier legacy fallback did exactly that and is removed.
 *
 * Output: a newline-joined "- bullet" string on `remixContext`; analytics
 * fields summarize what happened. `noContextProduced` is `true` exactly when
 * no eligible content was found (equivalently `summarySource === 'none'`).
 *
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { BrandBank } from '@reelmakeeasy/uip-planner-runtime'
import {
  BRAND_VIDEO_TYPE_VALUES,
  BrandBankSchema,
  describeMode,
} from '@reelmakeeasy/uip-planner-runtime'
import { z } from 'zod'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

const logger = createSubLogger('uip-remix-context-summarizer')

/** Per-bullet character cap; bullets are clamped at a word boundary. */
const BULLET_CHAR_CAP = 160

export interface RemixContextResult {
  /**
   * Structured brand carry for a brand remix: the source's brand source,
   * narrative-arc shape, and extracted brand bank. Present when the source
   * qualifies (valid input + bank; the shape is best-effort and may be null).
   * The bank's staged-asset images still point at
   * the SOURCE workspace here -- createUipSession clones them into the target
   * and rewrites the URIs before threading the carry into workflow params.
   * Undefined for non-brand / non-qualifying sources.
   */
  brandCarry?: {
    source_brand_bank: BrandBank
    source_brand_extraction_input: { kind: 'freeform'; text: string } | { kind: 'url'; url: string }
    // Null when the source locked without a narrative arc (pre-shape-era
    // project): the carry still qualifies; the planner asks the shape later.
    source_brand_video_type: 'friction_to_flow' | 'industry_explainer' | 'product_showcase' | null
  }
  /** End-to-end wall-clock time for building the carry-over bullets. */
  buildLatencyMs: number
  /** Whether `lockedAt` was set AND `spec.json` was successfully read from storage. */
  hadUipSpec: boolean
  /** True iff no carry-over context was produced (`remixContext` is undefined). */
  noContextProduced: boolean
  /** Newline-joined bullet string; undefined when there was no eligible content. */
  remixContext?: string
  /**
   * Brief provenance of the source's bank: the saved BrandBrief id recorded in
   * `global_constraints.brand_bank_source` when the bank was injected from the
   * brand library. Read from the RAW parsed spec, independent of
   * `meta.locked_at` (an unlocked brief-backed source still names its brief so
   * the remix selector can adopt it) and of `brand_extraction_input` (unlike
   * `brandCarry`). Null for extraction-built banks and missing/unreadable
   * specs.
   */
  sourceBrandBriefId: null | string
  /**
   * Matchable identity of an extraction-built bank: the bank's business name
   * plus the URL the brand was extracted from. Read from the RAW parsed spec
   * (same pre-gate rationale as `sourceBrandBriefId`). Lets consumers find the
   * org brief this brand was later SAVED into (brand-brief-save keys identity
   * on the same pair via findSameBrandBrief) when `brand_bank_source` predates
   * or lacks provenance. Null when the spec is missing/unreadable or carries
   * no matchable signal.
   */
  sourceBrandIdentity: null | { businessName: null | string; extractionUrl: null | string }
  /** Final char count of `remixContext`. Zero when none. */
  summaryChars: number
  /**
   * Path taken. `'none'` means no UIP spec (or no eligible fields) -- the
   * caller stores no context on the target project.
   */
  summarySource: 'none' | 'uip_spec'
}

interface UipSpecSourceFields {
  global_constraints?: {
    brand_bank?: unknown
    // Provenance of a pre-seeded bank ('brand_library' = saved brief injected
    // at session start); null/absent for banks built by in-session extraction.
    brand_bank_source?: null | { attached_via?: string; brief_id?: string; kind?: string }
    brand_extraction_input?:
      | null
      | { kind: 'freeform'; text: string }
      | { kind: 'url'; url: string }
    brand_video_type?: null | string
    target_audience?: null | string
    topic?: null | string
  }
  meta?: {
    audio_source?: null | string
    locked_at?: null | string
    mode_state?: {
      duration_seconds?: null | number
      input_type?: null | string
      mode?: null | string
    }
  }
}

/**
 * Generate the Remix carry-over bullets for a source project.
 *
 * Never throws. A missing or unreadable UIP spec returns
 * `summarySource: 'none'` with no `remixContext` -- non-UIP sources (demos,
 * legacy projects) carry nothing.
 *
 * @param sourceProjectId  Authorized source project ID (caller MUST
 *                         verify access via `projectService.canViewProject`
 *                         before invoking this function).
 */
export async function summarizeRemixSource(args: {
  sourceProjectId: string
}): Promise<RemixContextResult> {
  const { sourceProjectId } = args
  const startedAt = Date.now()

  // Only a locked UIP spec yields carry-over. Non-UIP sources (demos, legacy
  // projects) have no genuine planner decisions to inherit -- carry nothing.
  // Brief provenance (sourceBrandBriefId) and the matchable brand identity
  // (sourceBrandIdentity) are the exception: read pre-gate.
  const {
    lockedFields: specFields,
    sourceBrandBriefId,
    sourceBrandIdentity,
  } = await tryReadUipSpec(sourceProjectId)
  // The structured brand carry is consumed independently of the prose bullets
  // (createUipSession threads it into workflow params on its own), so it must
  // not be coupled to bullets.length -- a locked source with a valid brand
  // input + bank but no bullet-eligible prose fields still carries.
  const brandCarry = specFields ? (extractBrandCarry(specFields) ?? undefined) : undefined
  if (specFields) {
    const bullets = buildUipSpecBullets(specFields)
    if (bullets.length > 0) {
      const remixContext = joinBullets(bullets)
      return {
        buildLatencyMs: Date.now() - startedAt,
        hadUipSpec: true,
        noContextProduced: false,
        remixContext,
        sourceBrandBriefId,
        sourceBrandIdentity,
        summaryChars: remixContext.length,
        summarySource: 'uip_spec',
        brandCarry,
      }
    }
  }

  // No spec (or a spec with no eligible PROSE fields) -- no bullets are
  // carried; the structured brand carry (when qualified) still rides along.
  return {
    buildLatencyMs: Date.now() - startedAt,
    hadUipSpec: Boolean(specFields),
    noContextProduced: true,
    remixContext: undefined,
    sourceBrandBriefId,
    sourceBrandIdentity,
    summaryChars: 0,
    summarySource: 'none',
    brandCarry,
  }
}

function capitalizeFirst(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text
}

function joinBullets(bullets: string[]): string {
  return bullets.map((b) => `- ${b}`).join('\n')
}

/**
 * Map the `brand_video_type` enum to a stable, user-readable label for the
 * carry-over bullet. Returns null for null/unknown values so the bullet is
 * emitted only for a known brand shape. The planner maps these labels back to
 * the enum in section 2.6.5.
 */
function describeBrandVideoType(value: null | string | undefined): null | string {
  switch (value) {
    case 'friction_to_flow': {
      return 'Problem to Solution'
    }
    case 'industry_explainer': {
      return 'Industry Explainer'
    }
    case 'product_showcase': {
      return 'Product Showcase'
    }
    default: {
      return null
    }
  }
}

const BrandExtractionInputZ = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('freeform'), text: z.string().min(1) }),
])
const BrandVideoTypeZ = z.enum(BRAND_VIDEO_TYPE_VALUES)

/**
 * Extract validated structured brand carry from a source UIP spec.
 *
 * Qualification is best-effort around two mandatory legs: a valid
 * `brand_extraction_input` (the same-URL conversion keys off it) and a valid
 * `brand_bank` (the carry's substance -- it is what skips extraction). A
 * source with a missing/unparseable bank carries NOTHING -- the remix degrades
 * to the normal brand flow (fresh extraction via the section 2.6.2 auto-start),
 * which is the intended fallback, not an oversight.
 *
 * `brand_video_type` is OPTIONAL: pre-shape-era sources locked without it, and
 * dropping the whole carry over a missing arc would re-crawl a brand we
 * already extracted. A missing/unknown shape carries as null; the planner
 * collects it via the section 2.6.5 ask before MODE_CONFIRMED.
 */
export function extractBrandCarry(
  spec: UipSpecSourceFields,
): null | RemixContextResult['brandCarry'] {
  const gc = spec.global_constraints
  const inputParsed = BrandExtractionInputZ.safeParse(gc?.brand_extraction_input)
  const shapeParsed = BrandVideoTypeZ.safeParse(gc?.brand_video_type)
  const bankParsed = BrandBankSchema.safeParse(gc?.brand_bank)
  if (!inputParsed.success || !bankParsed.success) {
    return null
  }
  return {
    source_brand_extraction_input: inputParsed.data,
    source_brand_video_type: shapeParsed.success ? shapeParsed.data : null,
    source_brand_bank: bankParsed.data,
  }
}

/**
 * Bullets from a locked UIP spec, emitting a line only when its field is
 * present, in a stable order: type, length, source, topic, audience.
 *
 * `topic` and `target_audience` carry the direction/angle and who-it's-for
 * that the user settled during the section 2.5 refinement turn (the planner writes
 * the chosen topic + direction verbatim into `global_constraints.topic`, and
 * the audience into `global_constraints.target_audience`). Those are genuine
 * user decisions, not LLM guesses, and are the highest-signal thing to carry
 * into a remix -- without them the angle the user picked (e.g. "what it means
 * for investors") silently disappears. We still drop the remaining
 * `global_constraints` fields (tone / pacing / style / must_not_violate /
 * scopes / key_entities), which are LLM-inferred rails rather than explicit
 * user choices. We also omit `style` (shown by the style picker UI).
 */
export function buildUipSpecBullets(spec: UipSpecSourceFields): string[] {
  const ms = spec.meta?.mode_state ?? {}
  const bullets: string[] = []

  // 1. Type -- the literal "what type of video?" answer.
  if (ms.mode) {
    bullets.push(capitalizeFirst(describeMode(ms.mode)))
  }

  // 2. Length.
  if (ms.duration_seconds != null && ms.duration_seconds > 0) {
    bullets.push(`About ${ms.duration_seconds} seconds`)
  }

  // 3. Source of the content.
  const audioSource = spec.meta?.audio_source
  const inputType = ms.input_type
  if (audioSource === 'user_audio' || inputType === 'audio_music' || inputType === 'audio_script') {
    bullets.push('Built from your uploaded audio')
  } else if (inputType === 'script_only' || inputType === 'prompt_and_script') {
    bullets.push('Includes your written script')
  }

  // 4. Topic -- the subject + direction the user chose during refinement.
  const topic = spec.global_constraints?.topic?.trim()
  if (topic) {
    bullets.push(`About: ${clampBullet(topic)}`)
  }

  // 5. Target audience -- who the user said the video is for.
  const audience = spec.global_constraints?.target_audience?.trim()
  if (audience) {
    bullets.push(`For ${clampBullet(audience)}`)
  }

  // 6. Brand shape -- the narrative-arc enum (brand_video_type) the user chose
  // for a brand video. Carried with a stable, machine-readable prefix so a
  // Remix into a new brand video can set the shape and skip the section 2.6.5
  // re-ask; the planner maps the friendly label back to the enum. Emit only
  // when set to a known enum value (non-brand sources leave it null).
  const brandShape = describeBrandVideoType(spec.global_constraints?.brand_video_type)
  if (brandShape) {
    bullets.push(`Brand shape: ${brandShape}`)
  }

  return bullets
}

/**
 * Trim and, if over `max`, slice to the last word boundary and append an
 * ellipsis. Exported for unit testing.
 */
export function clampBullet(text: string, max = BULLET_CHAR_CAP): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) {
    return trimmed
  }
  const sliced = trimmed.slice(0, max)
  const lastSpace = sliced.lastIndexOf(' ')
  const cutoff = lastSpace > 0 ? lastSpace : sliced.length
  return `${sliced.slice(0, cutoff)}…`
}

/**
 * Validate a parsed source spec and gate carry-over on lock state. Returns the
 * usable fields ONLY when (a) the parsed value is a non-null object and (b) the
 * source spec is locked (`meta.locked_at` is a non-empty string).
 *
 * `persistSpecSnapshot` writes `spec/current/spec.json` on every snapshot --
 * including mid-planning, before the spec is locked -- so an unlocked spec holds
 * tentative planner guesses the user never confirmed. Carrying those would let a
 * remix inherit unfinished decisions and fast-path as if they were final, so we
 * carry nothing until the source is locked. Never throws; exported for testing.
 */
export function extractLockedSpecFields(parsed: unknown): null | UipSpecSourceFields {
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const spec = parsed as UipSpecSourceFields
  const lockedAt = spec.meta?.locked_at
  if (typeof lockedAt !== 'string' || lockedAt.trim() === '') {
    return null
  }
  return spec
}

/**
 * Brief provenance of a pre-seeded bank, read from the RAW parsed spec
 * (deliberately NOT lock-gated -- an unlocked brief-backed source still names
 * its brief). Null for extraction-built banks and malformed shapes. Never
 * throws; exported for testing.
 */
export function specSourceBrandBriefId(parsed: unknown): null | string {
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const source = (parsed as UipSpecSourceFields).global_constraints?.brand_bank_source
  return source?.kind === 'brand_library' && typeof source.brief_id === 'string'
    ? source.brief_id
    : null
}

/**
 * Matchable identity of an extraction-built bank, read from the RAW parsed
 * spec (deliberately NOT lock-gated, mirroring specSourceBrandBriefId): the
 * bank's `basic_info.business_name` and the `brand_extraction_input` URL.
 * These are exactly the two signals brand-brief-save keys a brief's library
 * identity on (findSameBrandBrief), so a consumer can locate the brief this
 * project's brand was saved into. Null when neither signal is present or the
 * shape is malformed. Never throws; exported for testing.
 */
export function specSourceBrandIdentity(
  parsed: unknown,
): RemixContextResult['sourceBrandIdentity'] {
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const constraints = (parsed as UipSpecSourceFields).global_constraints
  const input = constraints?.brand_extraction_input
  const extractionUrl =
    input?.kind === 'url' && typeof input.url === 'string' && input.url.trim().length > 0
      ? input.url.trim()
      : null
  const bank = constraints?.brand_bank
  const rawName =
    typeof bank === 'object' && bank !== null
      ? (bank as { basic_info?: { business_name?: unknown } }).basic_info?.business_name
      : undefined
  const businessName =
    typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : null
  return businessName === null && extractionUrl === null ? null : { businessName, extractionUrl }
}

async function tryReadUipSpec(projectId: string): Promise<{
  lockedFields: null | UipSpecSourceFields
  sourceBrandBriefId: null | string
  sourceBrandIdentity: RemixContextResult['sourceBrandIdentity']
}> {
  try {
    const file = fileStore.file(`projects/${projectId}/user-intent-planner/spec/current/spec.json`)
    const exists = await file.exists()
    if (!exists) {
      return { lockedFields: null, sourceBrandBriefId: null, sourceBrandIdentity: null }
    }
    const buf = await file.read()
    const parsed: unknown = JSON.parse(buf.toString())
    // Carry fields gate on lock + shape: an unlocked spec.json holds tentative
    // mid-planning data, and a malformed payload must not throw (carry-over is
    // best-effort). Brief provenance and the brand identity are the exception
    // -- read pre-gate, see specSourceBrandBriefId / specSourceBrandIdentity.
    return {
      lockedFields: extractLockedSpecFields(parsed),
      sourceBrandBriefId: specSourceBrandBriefId(parsed),
      sourceBrandIdentity: specSourceBrandIdentity(parsed),
    }
  } catch (err) {
    logger.warn(`[${projectId}] Failed to read source UIP spec: ${err}`)
    return { lockedFields: null, sourceBrandBriefId: null, sourceBrandIdentity: null }
  }
}
