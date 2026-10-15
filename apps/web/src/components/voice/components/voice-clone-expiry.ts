import { isVoiceCloneExpiredByDate } from '@reelmakeeasy/common/voice/voice-clone-expiration'

/**
 * Whether a saved voice clone can still be used.
 *
 * Extracted from `voice-over-selection.tsx` so the rule is testable on its own: that
 * module pulls in auth transitively, which cannot load under jest.
 * The rule itself is pure, and it decides whether a voice appears in any picker at all
 * (`isExpired` is what `useTranscriptPreviewVoiceOptions` and `AudioVoiceoverDialog`
 * filter on), so it is worth pinning.
 *
 * Expired if: created before the MiniMax accent-prompt fix, if it is a legacy
 * BytePlus clone (that path was removed, so those rows can never synthesize again),
 * or if the MiniMax retirement gate is on for legacy non-MiniMax clones.
 *
 * 'fal' is exempt from that last rule. It is the same MiniMax model reached
 * through fal.ai -- the forward path, not a legacy vendor -- and those clones synthesize
 * fine. The rule predates it, so without the exemption a freshly created Fal clone is
 * marked expired and silently filtered out of every picker.
 */
export function isVoiceExpired(
  provider: string | undefined,
  createdAt: string,
  enableMinimaxVoiceClone: boolean,
): boolean {
  if (isVoiceCloneExpiredByDate(createdAt)) {
    return true
  }
  if (provider === 'byteplus') {
    return true
  }
  if (enableMinimaxVoiceClone && provider !== 'minimax' && provider !== 'fal') {
    return true
  }
  return false
}
