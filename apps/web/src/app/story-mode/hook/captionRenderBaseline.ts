import type { RenderSettings } from '@/atom/longtake-history.store'

// Derive the caption render baseline from a polled project state. Legacy
// projects predate the caption toggle and persist enableCaption=null; the
// render pipeline captions anything that is not strictly false, so a null
// project's delivered video is captioned. Seed the baseline ON for null so
// toggling captions off registers as a change and forces a re-render, instead
// of the export short-circuiting to the captioned master.
export function nextCaptionRenderSettings(params: {
  persistedPref: boolean | undefined
  polledChanged: boolean
  polledEnableCaption: boolean | null
  prev: RenderSettings
}): RenderSettings {
  const { persistedPref, polledChanged, polledEnableCaption, prev } = params
  const polled = polledEnableCaption === null ? true : polledEnableCaption
  const newOriginal = polledChanged ? polled : prev.captionEnabled.original
  const newLatest = persistedPref ?? newOriginal
  if (prev.captionEnabled.original === newOriginal && prev.captionEnabled.latest === newLatest) {
    return prev
  }
  return { ...prev, captionEnabled: { original: newOriginal, latest: newLatest } }
}
