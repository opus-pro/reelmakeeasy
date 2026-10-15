import { BGM_DEFAULT_VOLUME } from '@reelmakeeasy/common/long-take/bgm-volume'
import {
  MUSIC_NOTE_MAX_LENGTH,
  MUSIC_TRACK_ID_MAX_LENGTH,
  type MusicTrackRef,
} from '@reelmakeeasy/common/long-take/music-craft'
import { BadRequestException } from '@nestjs/common'
import type { BgmRemuxOutcome } from '@shared/types/api/long-take'

export interface EffectiveBgm {
  /** Bed to bake, null when BGM is off or muted (voiceover-only delivery). */
  bedUri: null | string
  /** Panel volume, defaulted like the panel when none is persisted. */
  bgmVolume: number
  /**
   * Variant-key identity for the audible mix, undefined when no bed bakes.
   * 'm2' = mix-recipe version: pre-m2 4K variants keyed on the
   * volume but were baked at the default duck, so the version bump forces
   * them through one free recomposite instead of serving the stale mix.
   */
  signature?: string
}

export interface ParsedBgmSettings {
  bgmEnabled?: boolean
  bgmVolume?: number
}

/**
 * Effective BGM at a render/export start. A bed URI can linger
 * after the user disables BGM, and volume 0 is the voiceover-only delivery
 * (remux semantics) -- both mean "bake nothing". Every publisher of the
 * delivered video resolves its BGM through this one rule.
 */
export function resolveEffectiveBgm(project: {
  bgmBedUri?: null | string
  bgmEnabled?: boolean | null
  bgmVolume?: null | number
}): EffectiveBgm {
  const bgmVolume = project.bgmVolume ?? BGM_DEFAULT_VOLUME
  const audible = (project.bgmEnabled ?? false) && bgmVolume > 0
  const bedUri = audible ? (project.bgmBedUri ?? null) : null
  return {
    bedUri,
    bgmVolume,
    ...(bedUri ? { signature: `m2|${bedUri}|v${bgmVolume}` } : {}),
  }
}

/**
 * Workflow status names that mean a BGM (re)generation is in flight.
 * CONTINUED_AS_NEW never applies to the bgm-regen workflow today but maps to
 * running for safety; everything terminal (COMPLETED/FAILED/CANCELLED/
 * TERMINATED/TIMED_OUT) or unknown reads as not-generating.
 */
export function isRunningWorkflowStatus(statusName: null | string | undefined): boolean {
  return statusName === 'RUNNING' || statusName === 'CONTINUED_AS_NEW'
}

/**
 * Map a workflow status name to the shared BgmRemuxOutcome
 * (declared once in @shared/types/api/long-take -- the API contract shared
 * with the web client). describe() on the shared workflow id always reports
 * the newest run (TERMINATE_EXISTING replaces in place), so the client may
 * trust 'completed' as "the latest apply landed" and 'failed'/'terminated'
 * as "do not auto-download". 'not_started' is reserved for the DEFINITE
 * no-such-workflow answer (WorkflowNotFoundError, mapped by the caller) and
 * is never produced here -- everything indefinite (a probe error, or a
 * status name we cannot classify) must read as 'unknown', which never fires
 * anything.
 */
export function resolveBgmRemuxOutcome(statusName: string): BgmRemuxOutcome {
  if (isRunningWorkflowStatus(statusName)) {
    return 'running'
  }
  if (statusName === 'COMPLETED') {
    return 'completed'
  }
  if (statusName === 'FAILED' || statusName === 'TIMED_OUT') {
    return 'failed'
  }
  if (statusName === 'TERMINATED' || statusName === 'CANCELLED') {
    return 'terminated'
  }
  // The workflow exists but reports a status we cannot classify: indefinite.
  return 'unknown'
}

/**
 * Validate the music-panel settings body. Both fields are optional
 * but at least one must be present; the volume rides the panel's integer 0-100
 * scale. Throws BadRequestException so the controller surfaces a 400.
 */
export function parseBgmSettingsBody(body: unknown): ParsedBgmSettings {
  const raw = (body ?? {}) as Record<string, unknown>
  const parsed: ParsedBgmSettings = {}

  if (raw.bgmEnabled !== undefined) {
    if (typeof raw.bgmEnabled !== 'boolean') {
      throw new BadRequestException('bgmEnabled must be a boolean')
    }
    parsed.bgmEnabled = raw.bgmEnabled
  }

  if (raw.bgmVolume !== undefined) {
    if (
      typeof raw.bgmVolume !== 'number' ||
      !Number.isInteger(raw.bgmVolume) ||
      raw.bgmVolume < 0 ||
      raw.bgmVolume > 100
    ) {
      throw new BadRequestException('bgmVolume must be an integer between 0 and 100')
    }
    parsed.bgmVolume = raw.bgmVolume
  }

  if (parsed.bgmEnabled === undefined && parsed.bgmVolume === undefined) {
    throw new BadRequestException('At least one of bgmEnabled or bgmVolume is required')
  }

  return parsed
}

// Lyria prompts are ~20-40 words; this bounds abuse without constraining a
// legitimately verbose edit of the prefilled prompt.
export const BGM_PROMPT_MAX_LENGTH = 1000

export interface ParsedBgmVersionCreate {
  /**
   * The wish for a director take (a mood or the user's words), stored as the project's
   * bgmNote; null clears it so the director picks freely. Absent keeps the stored one.
   */
  note?: null | string
  prompt?: string
  /** A chosen track to fit; when present the prompt is ignored. */
  track?: MusicTrackRef
}

/**
 * Validate the regenerate ("create a BGM version") body. The prompt
 * is optional -- absent/blank means a fresh director take; when present it is
 * trimmed and length-capped. Throws BadRequestException for a 400.
 */
export function parseBgmVersionCreateBody(body: unknown): ParsedBgmVersionCreate {
  const raw = (body ?? {}) as Record<string, unknown>
  if (raw.track !== undefined && raw.track !== null) {
    const t = (typeof raw.track === 'object' ? raw.track : {}) as Partial<MusicTrackRef>
    const id = typeof t.id === 'string' ? t.id.trim().slice(0, MUSIC_TRACK_ID_MAX_LENGTH) : ''
    if (!id || (t.source !== 'library' && t.source !== 'upload')) {
      throw new BadRequestException('track must be { id, source: library | upload }')
    }
    return { track: { id, source: t.source } }
  }
  if ('note' in raw) {
    if (raw.note !== null && typeof raw.note !== 'string') {
      throw new BadRequestException('note must be a string or null')
    }
    const note = (raw.note ?? '').replace(/\s+/g, ' ').trim().slice(0, MUSIC_NOTE_MAX_LENGTH)
    return { note: note || null }
  }
  if (raw.prompt === undefined || raw.prompt === null) {
    return {}
  }
  if (typeof raw.prompt !== 'string') {
    throw new BadRequestException('prompt must be a string')
  }
  const prompt = raw.prompt.trim()
  if (prompt.length > BGM_PROMPT_MAX_LENGTH) {
    throw new BadRequestException(`prompt must be at most ${BGM_PROMPT_MAX_LENGTH} characters`)
  }
  return prompt === '' ? {} : { prompt }
}
