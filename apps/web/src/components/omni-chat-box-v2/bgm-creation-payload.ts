import type { ApplyLongTakeTemplatePayload } from '@/atom/home'
import type { CreateUseCaseKey } from '@/constants/create-use-cases'

/**
 * Entry flows that never carry a generated bed, so every BGM path reads off.
 * Song-to-Video already uses the uploaded song as its soundtrack.
 */
export function isSubmissionBgmDisabled(useCaseKey?: CreateUseCaseKey): boolean {
  return useCaseKey === 'song-to-video'
}

/**
 * Seed remix BGM carry state at template-apply time.
 *
 * Every apply invalidates prior carried intent; a remix then resets the toggle
 * (a previous composition's ON must not leak into a payload that carries no
 * BGM) and, when the source had BGM on, re-arms the intent bound to this
 * source project. The reconciler (useRemixBgmCarry) seeds the toggle or drops
 * the intent once the composer settles -- deciding here would race flag
 * hydration on cold landings. Not gated on enable_bgm: the flag may not have
 * hydrated yet, and the atoms are inert while the gate is off
 * (resolveCreationBgmEnabled omits the field). Style copies carry style only,
 * never source context.
 */
export function seedRemixBgmCarry(
  payload: ApplyLongTakeTemplatePayload,
  setMusicEnabled: (enabled: boolean) => void,
  setPendingRemixBgm: (pending: null | { sourceProjectId: string }) => void,
): void {
  setPendingRemixBgm(null)
  if (!payload.remixProjectId || payload.isStyleCopy) {
    return
  }
  setMusicEnabled(false)
  if (payload.bgmEnabled === true) {
    setPendingRemixBgm({ sourceProjectId: payload.remixProjectId })
  }
}
