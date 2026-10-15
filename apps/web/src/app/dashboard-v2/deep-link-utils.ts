import type { QuickStartTemplate } from '@shared/types/assets/quick-start'

import {
  QUICK_START_TEMPLATE_QUERY_KEY,
  QUICK_START_TEMPLATE_SOURCE_QUERY_KEY,
  QUICK_START_TEMPLATE_SOURCES,
  type QuickStartTemplateSource,
} from '@/app/story-mode/navigation'
import type { CreateWorkflow } from '@/constants/create-use-cases'

const QUICK_START_SOURCE_TO_WORKFLOW: Record<QuickStartTemplateSource, CreateWorkflow> = {
  [QUICK_START_TEMPLATE_SOURCES.storyMode]: 'story-mode',
}

const WORKFLOW_TO_QUICK_START_SOURCE: Record<CreateWorkflow, QuickStartTemplateSource> = {
  'story-mode': QUICK_START_TEMPLATE_SOURCES.storyMode,
}

export const QUICK_START_DEEP_LINK_QUERY_KEYS = [
  QUICK_START_TEMPLATE_QUERY_KEY,
  QUICK_START_TEMPLATE_SOURCE_QUERY_KEY,
] as const

export function getQuickStartSourceFromWorkflow(
  workflow: CreateWorkflow,
): QuickStartTemplateSource {
  return WORKFLOW_TO_QUICK_START_SOURCE[workflow]
}

export function getWorkflowFromQuickStartSource(value: null | string): CreateWorkflow | null {
  if (!isQuickStartTemplateSource(value)) {
    return null
  }
  return QUICK_START_SOURCE_TO_WORKFLOW[value]
}

export function getWorkflowFromQuickStartTemplate(_template: QuickStartTemplate): CreateWorkflow {
  return 'story-mode'
}

/** The demo bucket a template belongs to. */
export function getQuickStartSourceFromTemplate(
  template: QuickStartTemplate,
): QuickStartTemplateSource {
  return getQuickStartSourceFromWorkflow(getWorkflowFromQuickStartTemplate(template))
}

export function isQuickStartTemplateSource(
  value: null | string,
): value is QuickStartTemplateSource {
  return value !== null && (Object.values(QUICK_START_TEMPLATE_SOURCES) as string[]).includes(value)
}

/**
 * Pick the demo bucket that actually holds the deep-linked template, trying
 * `candidates` in priority order.
 *
 * The source query param is a hint, not a guarantee: a stale or mismatched hint
 * can point at a bucket that never got the template, which would strand the
 * template dialog on its empty-list "Loading..." state. Falling through to the
 * next candidate keeps a stale link working.
 */
export function resolveDeepLinkTemplateLocation(
  templateId: string,
  templatesBySource: Record<QuickStartTemplateSource, QuickStartTemplate[]>,
  candidates: (null | QuickStartTemplateSource)[],
): null | { index: number; source: QuickStartTemplateSource; templates: QuickStartTemplate[] } {
  for (const source of candidates) {
    if (!source) {
      continue
    }
    const templates = templatesBySource[source]
    const index = templates.findIndex((item) => item.projectId === templateId)
    if (index !== -1) {
      return { index, source, templates }
    }
  }
  return null
}
