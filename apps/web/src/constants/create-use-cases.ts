import { getPublicCdnUrl } from '@/util/cdn-utils'

export const CREATE_USE_CASE_QUERY_PARAM = 'create'

export type CreateUseCaseConfig = {
  /** Autoplaying preview clip shown on the dashboard create grid card, if any. */
  cardVideoUrl?: string
  dashboardV2SidebarLabel: string
  dashboardV2Title: string
  defaultPrompt?: string
  description: string
  key: CreateUseCaseKey
  path: string
  placeholderText?: string
  sidebarLabel: string
  sidebarMetaLabel?: string
  title: string
  workflow: CreateWorkflow
}

export type CreateUseCaseKey =
  | 'animation-style-ad'
  | 'audio-to-video'
  | 'news-article-to-video'
  | 'script-to-video'
  | 'song-to-video'

export type CreateWorkflow = 'story-mode'

// Card preview clips for the dashboard create grid, served from the web app's public folder.
const USE_CASE_VIDEO_BASE = getPublicCdnUrl('agent/use-case-videos')

export const CREATE_USE_CASES: CreateUseCaseConfig[] = [
  {
    cardVideoUrl: `${USE_CASE_VIDEO_BASE}/script-to-video.mp4`,
    description: 'Add a transcript and choose or create your preferred style.',
    key: 'script-to-video',
    path: '/story-mode',
    placeholderText: 'Describe your video idea or upload an audio file as a voiceover',
    sidebarLabel: 'Script to video',
    sidebarMetaLabel: 'Story Mode',
    title: 'Script to video',
    workflow: 'story-mode',
    dashboardV2Title: 'story video',
    dashboardV2SidebarLabel: 'Script to video',
  },
  {
    cardVideoUrl: `${USE_CASE_VIDEO_BASE}/song-to-video.mp4`,
    description: 'Upload a song or audio file and turn it into a music video.',
    key: 'song-to-video',
    path: '/story-mode',
    placeholderText: 'Upload an audio file with your song to create music video',
    sidebarLabel: 'Song to video',
    title: 'Song to video',
    workflow: 'story-mode',
    dashboardV2Title: 'story video',
    dashboardV2SidebarLabel: 'Song to video',
  },
  {
    cardVideoUrl: `${USE_CASE_VIDEO_BASE}/audio-to-video.mp4`,
    description: 'Upload a voiceover or add a transcript to turn it into a polished video.',
    key: 'audio-to-video',
    path: '/story-mode',
    placeholderText: 'Upload an audio file or paste a transcript to turn it into a video',
    sidebarLabel: 'Audio to video',
    title: 'Audio to video',
    workflow: 'story-mode',
    dashboardV2Title: 'story video',
    dashboardV2SidebarLabel: 'Audio to video',
  },
  {
    description: 'Turn a concept into an animated social ad with strong visual pacing.',
    key: 'animation-style-ad',
    path: '/story-mode',
    placeholderText: 'Create an animation-style ad about...',
    sidebarLabel: 'Assets to ads',
    title: 'Assets to ads',
    workflow: 'story-mode',
    dashboardV2Title: 'story video',
    dashboardV2SidebarLabel: 'Assets to ads',
  },
  {
    description: 'Turn a news story or article link into a concise, engaging video.',
    // Statically on the Story Mode (UIP) workflow since the
    // uip_article_extraction_enabled GA (sunset ladder step 2). The
    // entry key travels as entry_use_case, which arms server-side article
    // extraction; the legacy /videos news pipeline no longer receives sessions.
    key: 'news-article-to-video',
    path: '/story-mode',
    placeholderText: 'Turn a link into a video: ',
    sidebarLabel: 'News/article to video',
    title: 'News/article to video',
    workflow: 'story-mode',
    dashboardV2Title: 'news/article video',
    dashboardV2SidebarLabel: 'News/article to video',
  },
]

const CREATE_USE_CASES_BY_KEY = new Map<CreateUseCaseKey, CreateUseCaseConfig>(
  CREATE_USE_CASES.map((useCase) => [useCase.key, useCase]),
)

// Home omnibox chip order.
const DASHBOARD_USE_CASE_KEYS: CreateUseCaseKey[] = [
  'script-to-video',
  'song-to-video',
  'audio-to-video',
  'animation-style-ad',
]

export function getCreateUseCase(key: CreateUseCaseKey): CreateUseCaseConfig {
  const useCase = CREATE_USE_CASES_BY_KEY.get(key)
  if (!useCase) {
    throw new Error(`Unknown create use case: ${key}`)
  }
  return useCase
}

export function getDashboardUseCases(): CreateUseCaseConfig[] {
  return DASHBOARD_USE_CASE_KEYS.map(getCreateUseCase)
}

// Use cases whose /home?create=... door renders as a focused create screen:
// the home chip row hides (the sunset chip list carries no matching chip) and
// the mobile create sheet omits them from its switcher. Today that is only
// the news door. Successor of the Labs deep-link list -- the Labs cards were
// removed 2026-08-05 and AI UGC's entrances closed with them.
export const FOCUSED_CREATE_USE_CASE_KEYS = ['news-article-to-video'] as const
export function isFocusedCreateUseCaseKey(key: null | string | undefined): boolean {
  return key != null && (FOCUSED_CREATE_USE_CASE_KEYS as readonly string[]).includes(key)
}
