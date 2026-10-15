const noop = () => undefined

const LEGACY_SLOT = { active: false, complete: noop, dismiss: noop, orchestrated: false }

/** Announcements are not orchestrated in ReelMakeEasy; surfaces keep their standalone behavior. */
export function useOrchestratedAnnouncementSlot(_id: null | string): {
  active: boolean
  complete: () => void
  dismiss: () => void
  orchestrated: boolean
} {
  return LEGACY_SLOT
}
