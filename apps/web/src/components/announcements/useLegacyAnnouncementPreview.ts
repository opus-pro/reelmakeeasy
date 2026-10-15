const NOT_FORCED = { forced: false, suppressed: false }

/** Announcement previews do not exist in ReelMakeEasy, so nothing is forced or suppressed. */
export function useLegacyAnnouncementPreview(_id: null | string): {
  forced: boolean
  suppressed: boolean
} {
  return NOT_FORCED
}
