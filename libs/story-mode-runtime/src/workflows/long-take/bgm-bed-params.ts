import type { CameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'

import type {
  BgmTrackArg,
  FitLongTakeBgmTrackActivityParams,
  GenerateLongTakeBgmBedActivityParams,
  GenerateLongTakeBgmBedActivityResult,
} from './types'

/**
 * The bed activity's params for a run, or null when no bed is wanted: music off (or never
 * chosen), or no sized voice-over yet. The user's wish rides along as the director's
 * `userRequest`.
 */
export function bgmBedActivityParams(input: {
  bgmEnabled?: boolean | null
  bgmNote?: null | string
  cameraStyle?: CameraStyle
  durationSec?: number
  orgId?: string
  projectId: string
  styleName?: string
  styleText?: string
  userEmail?: string
  userId: string
}): GenerateLongTakeBgmBedActivityParams | null {
  const {
    bgmEnabled,
    bgmNote,
    cameraStyle,
    durationSec,
    orgId,
    projectId,
    styleName,
    styleText,
    userEmail,
    userId,
  } = input
  if (!bgmEnabled || !durationSec || durationSec <= 0) return null
  return {
    ...(cameraStyle ? { cameraStyle } : {}),
    durationSec,
    // durationSec on this path IS the voice-over duration, so a voice-over always
    // accompanies the bed.
    hasVoiceover: true,
    ...(orgId ? { orgId } : {}),
    projectId,
    ...(styleName ? { styleName } : {}),
    ...(styleText ? { styleText } : {}),
    ...(userEmail ? { userEmail } : {}),
    userId,
    ...(bgmNote ? { userRequest: bgmNote } : {}),
  }
}

/** What a run does for its bed: generate one, or fit the track the user chose. */
export type BgmBedStep =
  | { kind: 'generate'; params: GenerateLongTakeBgmBedActivityParams }
  | { kind: 'track'; params: FitLongTakeBgmTrackActivityParams }

/** The bed step for a run, or null when no bed is wanted. A chosen track wins over the wish. */
export function bgmBedStep(
  input: Parameters<typeof bgmBedActivityParams>[0] & { bgmTrack?: BgmTrackArg | null },
): BgmBedStep | null {
  const { bgmTrack, ...rest } = input
  const generate = bgmBedActivityParams(rest)
  if (!generate) return null
  if (!bgmTrack) return { kind: 'generate', params: generate }
  const { durationSec, orgId, projectId, userEmail, userId } = generate
  return {
    kind: 'track',
    params: {
      durationSec,
      ...(orgId ? { orgId } : {}),
      projectId,
      track: bgmTrack,
      ...(userEmail ? { userEmail } : {}),
      userId,
    },
  }
}

/**
 * Runs a bed step and never rejects: a bed is best effort, so a failed generation or an
 * unknown track (a library id the manifest no longer has) logs and yields no bed.
 */
export async function runBgmBedStep(
  step: BgmBedStep | null,
  deps: {
    fitTrack: (
      params: FitLongTakeBgmTrackActivityParams,
    ) => Promise<GenerateLongTakeBgmBedActivityResult>
    generateBed: (
      params: GenerateLongTakeBgmBedActivityParams,
    ) => Promise<GenerateLongTakeBgmBedActivityResult | null>
    logError: (message: string, fields: { error: { message: string } }) => void
  },
): Promise<GenerateLongTakeBgmBedActivityResult | null> {
  if (!step) return null
  try {
    return step.kind === 'track'
      ? await deps.fitTrack(step.params)
      : await deps.generateBed(step.params)
  } catch (error) {
    deps.logError('longTakeWorkflow BGM bed step failed (non-fatal)', {
      error: { message: error instanceof Error ? error.message : String(error) },
    })
    return null
  }
}
