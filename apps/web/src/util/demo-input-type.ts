import type { CreateUseCaseKey } from '@/constants/create-use-cases'
import { getCreateUseCase } from '@/constants/create-use-cases'

const SPECIAL_INPUT_TYPE_BY_USE_CASE: Partial<Record<CreateUseCaseKey, string>> = {
  'animation-style-ad': getCreateUseCase('animation-style-ad').dashboardV2SidebarLabel,
  'audio-to-video': getCreateUseCase('audio-to-video').dashboardV2SidebarLabel,
  'song-to-video': getCreateUseCase('song-to-video').dashboardV2SidebarLabel,
}

// The Reference to video entry's own bucket: demos tagged with this
// label group under that entry rather than the input-type tabs, so it is
// special like the three chip labels -- a ref-only demo leaves the default
// gallery. The label matches the admin's DEMO_INPUT_TYPE_OPTIONS entry.
export const REFERENCE_TO_VIDEO_INPUT_TYPE = 'Reference to Video'

const SPECIAL_INPUT_TYPES = new Set(
  [...Object.values(SPECIAL_INPUT_TYPE_BY_USE_CASE), REFERENCE_TO_VIDEO_INPUT_TYPE].map(
    normalizeInputType,
  ),
)

export const DEFAULT_DEMO_VIEW_SIZE = 33
// Per-request page size, NOT a ceiling on how many demos the gallery loads --
// the caller pages until the list is exhausted. Fifty is the largest page the
// public endpoint still caches, so this is the cheapest page to ask
// for repeatedly. Raising it past that silently disables caching.
export const FILTERABLE_DEMO_PAGE_SIZE = 50

// Page ceiling for fetchAllDemoProjects. Ten pages of FILTERABLE_DEMO_PAGE_SIZE
// is the largest walk that keeps every request inside the endpoint's cacheable
// envelope (page <= 10, size <= 50).
export const MAX_DEMO_PROJECT_PAGES = 10

// Hard ceiling on cards the gallery renders, derived from the Story Mode walk so
// it can never truncate a demo an admin activated. Keep it derived -- a
// hardcoded value silently stops covering the list the moment the walk is resized.
//
// It is a runaway-corpus backstop, not a view budget. Do NOT lower it to "tune
// performance". Measured in Chromium against the card's real semantics
// (preload='none', play/pause on a 200px IntersectionObserver): concurrently
// playing videos stay viewport-bounded at ~10-12 regardless of list length, JS
// heap is flat (1.3MB at 44 cards, 1.2MB at 400) and build cost is 6.9ms at 44
// / 31ms at 400, with no WebMediaPlayer exhaustion. See
// docs/constraints/dont-cap-the-demo-gallery-render-list.md.
export const DEMO_GALLERY_MAX_RENDERED = MAX_DEMO_PROJECT_PAGES * FILTERABLE_DEMO_PAGE_SIZE

export function demoMatchesReferenceToVideo(inputType: null | string | undefined): boolean {
  return splitDemoInputTypes(inputType)
    .map(normalizeInputType)
    .includes(normalizeInputType(REFERENCE_TO_VIDEO_INPUT_TYPE))
}

export function demoMatchesSelectedUseCase(
  inputType: null | string | undefined,
  selectedUseCaseKey: CreateUseCaseKey,
): boolean {
  const inputTypes = splitDemoInputTypes(inputType).map(normalizeInputType)
  const selectedSpecialInputType = SPECIAL_INPUT_TYPE_BY_USE_CASE[selectedUseCaseKey]

  if (selectedSpecialInputType) {
    return inputTypes.includes(normalizeInputType(selectedSpecialInputType))
  }

  // Every non-special top-row entry uses the existing default gallery. A demo
  // stays there when it is untagged or carries any legacy/Script label; demos
  // tagged only with special labels stay hidden until that icon is selected.
  return inputTypes.length === 0 || inputTypes.some((value) => !SPECIAL_INPUT_TYPES.has(value))
}

export function getDemoMetadataPageSize(inputTypeFilteringEnabled: boolean): number {
  return inputTypeFilteringEnabled ? FILTERABLE_DEMO_PAGE_SIZE : DEFAULT_DEMO_VIEW_SIZE
}

export function splitDemoInputTypes(inputType: null | string | undefined): string[] {
  return (inputType ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function normalizeInputType(value: string): string {
  return value.trim().toLowerCase()
}
