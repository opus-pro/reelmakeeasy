import { EXPANDED_STORY_MODE_LIMITS } from '@reelmakeeasy/common/story-mode/user-limits'
import { countWords } from '@reelmakeeasy/common/utils/text'
import { BadRequestException } from '@nestjs/common'

import type { UipSessionState } from './uip-timeline-types'

/**
 * Defense ceiling at the API boundary; the effective cap is enforced by
 * `auditScriptWordCap` in the planner runtime. This guard only rejects obvious
 * abuse before paying for a storage write.
 */
export function validateScriptReviewInput(
  script: string,
  sessionState?: null | UipSessionState,
): void {
  const wordCount = countWords(script.trim())
  // A blank transcript persists as an empty script, and the client then builds no
  // script_transcript block from it -- the Script section reverts to its generating
  // checklist and the Voiceover section disappears, so the session reads as if the
  // script step never ran. There is no legitimate blank script, so reject it here too.
  if (wordCount === 0) {
    throw new BadRequestException('Transcript cannot be empty.')
  }
  const cap = EXPANDED_STORY_MODE_LIMITS.absoluteMaxScriptWords
  if (wordCount > cap) {
    throw new BadRequestException(`Transcript exceeds ${cap} words (current: ${wordCount}).`)
  }
  if (sessionState?.audio_source === 'user_audio') {
    throw new BadRequestException(
      'Script is locked in audio mode; only global_constraints can be edited.',
    )
  }
}
