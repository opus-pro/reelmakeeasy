import { Logger } from '@reelmakeeasy/common/logger'
import { pickedVoiceUnavailableReason } from '@reelmakeeasy/common/tts/voice-engines'
import { isVoiceCloneExpiredByDate } from '@reelmakeeasy/common/voice/voice-clone-expiration'
import { BadRequestException } from '@nestjs/common'
import type { ProjectVoiceOverJson } from '@shared/types/api/project'

import type { PrismaService } from '../prisma/prisma.service'
import { presetPreviewData } from '../voice-over/voice-over'

export type ResolvedRequestVoice = {
  /**
   * The voiceId to forward into stored request metadata + workflow args.
   * Undefined if the guard stripped (foreign clone, clone-row collision,
   * or expired clone).
   */
  validatedVoiceId: string | undefined
  /**
   * Full ProjectVoiceOverJson to persist into Project.voiceOverJson. Undefined
   * when no preset/clone match (unknown voiceId stays runtime-only -- see file
   * header for the explicit persistence/runtime mismatch caveat).
   */
  voiceOverJson: ProjectVoiceOverJson | undefined
}

type CloneRow = {
  createdAt: Date
  id: string
  name: string
  orgId: null | string
  provider: null | string
  voiceId: string
}

function isCallerOwned(row: CloneRow, callerOrgId: string | undefined): boolean {
  if (row.orgId === null) {
    return true
  }
  return Boolean(callerOrgId) && row.orgId === callerOrgId
}

function pickSingleOwnedClone(
  clones: CloneRow[],
  callerOrgId: string | undefined,
): CloneRow | undefined {
  if (clones.length !== 1) {
    return undefined
  }
  const [row] = clones
  return isCallerOwned(row, callerOrgId) ? row : undefined
}

/**
 * Single source of truth for "what to do with this voiceId."
 *
 * Reads userVoiceClone once, then categorizes by row-count:
 *   - 0 rows + preset match -> voice-over shape, allow.
 *   - 0 rows + no preset match -> allow voiceId for runtime fallback, but
 *       voiceOverJson is undefined (accepted persistence/runtime mismatch
 *       for legacy direct-API callers).
 *   - 1 row, caller-owned (org match or null-org legacy) -> voice-cloned shape, allow.
 *   - 1 row, foreign org -> strip.
 *   - 2+ rows (any collision) -> strip -- runtime provider lookup elsewhere is
 *       bare-voiceId, so persisting one row while runtime picks another would
 *       route audio through the wrong provider.
 */
export async function resolveLongTakeRequestVoice(
  deps: { logger: Pick<Logger, 'warn'>; prisma: PrismaService },
  voiceId: string | undefined,
  callerOrgId: string | undefined,
): Promise<ResolvedRequestVoice> {
  if (!voiceId) {
    return { validatedVoiceId: undefined, voiceOverJson: undefined }
  }

  const clones = (await deps.prisma.userVoiceClone.findMany({
    select: { createdAt: true, id: true, name: true, orgId: true, provider: true, voiceId: true },
    where: { voiceId },
  })) as CloneRow[]

  // Clone-table check FIRST -- defense in depth so a colliding clone row is
  // never bypassed just because the voiceId also exists in the preset catalog.
  if (clones.length > 0) {
    const owned = pickSingleOwnedClone(clones, callerOrgId)
    if (owned) {
      // Strip clones predating the MiniMax accent-prompt fix.
      if (isVoiceCloneExpiredByDate(owned.createdAt)) {
        deps.logger.warn(
          {
            createdAt: owned.createdAt,
            requestedOrgId: callerOrgId,
            voiceCloneId: owned.id,
            voiceId,
          },
          'Blocked Story Mode request: voice clone expired',
        )
        return { validatedVoiceId: undefined, voiceOverJson: undefined }
      }
      return {
        validatedVoiceId: voiceId,
        voiceOverJson: {
          name: owned.name,
          type: 'voice-cloned',
          voiceCloneId: owned.id,
          voiceId: owned.voiceId,
          ...(owned.provider ? { provider: owned.provider } : {}),
        },
      }
    }
    deps.logger.warn(
      {
        cloneRowCount: clones.length,
        requestedOrgId: callerOrgId,
        requestedVoiceId: voiceId,
      },
      'Blocked Story Mode request: voice clone is foreign or has provider/org collision',
    )
    return { validatedVoiceId: undefined, voiceOverJson: undefined }
  }

  // No clone rows -> preset catalog (in-memory).
  const preset = presetPreviewData.find((v) => v.voiceId === voiceId)
  // A Gemini voice speaks on GEMINI_API_KEY whoever makes the videos: refuse the start without
  // it, in the words the voice list shows, rather than fail at the voiceover step.
  const unavailable = preset ? pickedVoiceUnavailableReason(voiceId) : undefined
  if (unavailable) throw new BadRequestException(unavailable)
  if (preset) {
    return {
      validatedVoiceId: voiceId,
      voiceOverJson: {
        name: preset.name,
        type: 'voice-over',
        voiceId: preset.voiceId,
        ...(preset.labels?.length ? { labels: preset.labels } : {}),
        ...(preset.previewAudioUrl ? { previewAudioUrl: preset.previewAudioUrl } : {}),
        ...(preset.provider ? { provider: preset.provider } : {}),
      },
    }
  }

  // Unknown voiceId -- allow for runtime fallback but no Postgres write.
  return { validatedVoiceId: voiceId, voiceOverJson: undefined }
}
