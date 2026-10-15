import type { Project } from '@shared/types/api/project'

export type ProjectStatusMeta = {
  label: string
  tone: 'default' | 'error'
}

const MOTION_DESIGNER_PREFIX = /^@motion-designer\s*/i

export function getProjectDisplayTitle(project: Project): string {
  const explicitTitle = getNonEmptyString(project.name)
  if (explicitTitle) {
    return explicitTitle
  }

  const promptTitle = getNonEmptyString(project.initPrompt?.replace(MOTION_DESIGNER_PREFIX, ''))
  if (promptTitle) {
    return promptTitle
  }

  return 'Untitled'
}

// Map the card's status label tone to a text color.
export function resolveCardFooter(statusMeta: ProjectStatusMeta): {
  className: string
  label: string
} {
  return {
    className: statusMeta.tone === 'error' ? 'text-error' : 'text-secondary',
    label: statusMeta.label,
  }
}

function getNonEmptyString(value: unknown): null | string {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
