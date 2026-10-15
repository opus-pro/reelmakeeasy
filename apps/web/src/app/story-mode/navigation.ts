export const QUICK_START_TEMPLATE_QUERY_KEY = 'quick-start-template'
export const QUICK_START_TEMPLATE_SOURCE_QUERY_KEY = 'quick-start-template-source'

export const QUICK_START_TEMPLATE_SOURCES = {
  storyMode: 'story-mode',
} as const

export type QuickStartTemplateSource =
  (typeof QUICK_START_TEMPLATE_SOURCES)[keyof typeof QUICK_START_TEMPLATE_SOURCES]

export function buildStoryModeTemplateUrl(templateId: string): string {
  return `/home?${QUICK_START_TEMPLATE_QUERY_KEY}=${encodeURIComponent(templateId)}&${QUICK_START_TEMPLATE_SOURCE_QUERY_KEY}=${QUICK_START_TEMPLATE_SOURCES.storyMode}`
}
