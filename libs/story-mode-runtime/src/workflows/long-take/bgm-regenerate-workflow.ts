// On-demand bed regeneration from the music panel. Started with the
// default (FAIL) conflict policy on `ao:{projectId}:story-mode:bgm-regen`, so
// unlike the settings remux a concurrent start surfaces "already in progress"
// instead of superseding a run mid-generation.

import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import { proxyActivitiesWrapper } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'

import type * as activities from '../../activities/long-take'
import { createWorkflowLogger } from '../../utilities/workflow-logger'

import {
  clearLongTakeBgmRun,
  fitLongTakeBgmTrack,
  generateLongTakeBgmBed,
  persistLongTakeBgmBed,
} from './activity-proxies'
import type {
  LongTakeBgmRegenerateWorkflowParams,
  LongTakeBgmRegenerateWorkflowResult,
} from './types'

// Same envelope as the settings remux workflow: download + two lossless
// re-muxes + upload, with a heartbeat to kill a hung ffmpeg quickly.
const { remuxLongTakeBgm } = proxyActivitiesWrapper<Pick<typeof activities, 'remuxLongTakeBgm'>>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 2,
  },
})

export async function LongTakeBgmRegenerateWorkflow(
  params: LongTakeBgmRegenerateWorkflowParams,
): Promise<LongTakeBgmRegenerateWorkflowResult> {
  const {
    bgmEnabled,
    bgmRunStartedAt,
    bgmVolume,
    durationSec,
    existingVersions,
    orgId,
    projectId,
    prompt,
    remuxDelivered,
    track,
    userEmail,
    userId,
    userRequest,
  } = params
  setWorkflowScopedContext({ projectId, userEmail, userId })
  const logger = createWorkflowLogger({ projectId, userId })

  // Stop the card's status pill spinning for a run that will never
  // settle.
  const clearBgmRunBestEffort = async () => {
    try {
      await clearLongTakeBgmRun({ projectId, userEmail, userId })
    } catch (error) {
      // Non-fatal: the card's staleness ceiling hides an uncleared record.
      logger.error('LongTakeBgmRegenerateWorkflow bgmRun clear failed (non-fatal)', {
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  let bed: Awaited<ReturnType<typeof generateLongTakeBgmBed>>
  try {
    // A chosen track is fitted (no director, no music model); otherwise a bed is made.
    bed = track
      ? await fitLongTakeBgmTrack({ durationSec, orgId, projectId, track, userEmail, userId })
      : await generateLongTakeBgmBed({
          durationSec,
          hasVoiceover: true,
          orgId,
          projectId,
          promptOverride: prompt,
          userId,
          ...(userRequest ? { userRequest } : {}),
        })
    if (!bed) {
      await clearBgmRunBestEffort()
      return { applied: 'skipped_gate' }
    }
    await persistLongTakeBgmBed({
      bed,
      // Settle the status pill in the same patch as the bed swap.
      bgmRun: {
        kind: existingVersions.length > 0 ? 'regenerate' : 'generate',
        settledAt: new Date().toISOString(),
        startedAt: bgmRunStartedAt ?? new Date().toISOString(),
        status: 'done',
      },
      bgmVersions: [
        ...existingVersions,
        {
          // The parity gain measured for THIS bed, so switching back
          // to it later restores its live-preview loudness rather than the
          // gain of whichever bed happens to be current. Absent when the
          // measurement failed (best-effort), same as the project scalar.
          ...(bed.bedToVoiceGainDb === undefined ? {} : { bedToVoiceGainDb: bed.bedToVoiceGainDb }),
          createdAt: new Date().toISOString(),
          model: bed.model,
          prompt: bed.prompt,
          ...(bed.source ? { source: bed.source } : {}),
          ...(bed.trackId ? { trackId: bed.trackId } : {}),
          trackName: bed.trackName,
          uri: bed.fileUri,
        },
      ],
      projectId,
      userEmail,
      userId,
    })
  } catch (error) {
    await clearBgmRunBestEffort()
    throw error
  }

  // Rebuild the delivered final/watermark only when the bed is audible there;
  // when BGM is toggled off (or muted) the delivered file is already
  // voiceover-only and the new bed exists for preview/re-enable. Failures are
  // non-fatal: the next settings edit re-muxes with the new bed anyway.
  let remux: LongTakeBgmRegenerateWorkflowResult['remux']
  if (remuxDelivered && bgmEnabled && bgmVolume > 0) {
    try {
      remux = await remuxLongTakeBgm({
        bgmBedUri: bed.fileUri,
        bgmEnabled,
        bgmVolume,
        projectId,
        userEmail,
        userId,
      })
    } catch (error) {
      logger.error('LongTakeBgmRegenerateWorkflow delivery remux failed (non-fatal)', {
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  return { applied: 'regenerated', bedCdnUrl: bed.cdnUrl, remux, trackName: bed.trackName }
}
