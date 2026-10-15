import { ProgressBulkItem } from '@shared/types/agent/progress'
import { ProjectStage, UipCardStatus } from '@shared/types/api/project'
import { PROJECT_STAGE } from '@shared/types/enums/project'

import { formatDate } from '@/util/date-format'

export type ProjectCardStatusMeta = {
  label: string
  tone: 'default' | 'error'
}

type ProjectCardStatusInput = {
  createdAt: Date | string
  isCanceled: boolean
  isFailed: boolean
  isFinished: boolean
  progress?: { targetPhase: ProgressBulkItem['targetPhase']; value: number }
  stage?: ProjectStage
  uip?: UipCardStatus
}

export function computeProjectCardLabel(input: ProjectCardStatusInput): ProjectCardStatusMeta {
  const { createdAt, isCanceled, isFailed, isFinished, progress, stage, uip } = input

  if (isFailed) {
    return { label: 'Project failed', tone: 'error' }
  }
  if (isCanceled) {
    return { label: 'Project canceled', tone: 'error' }
  }
  if (isFinished) {
    return { label: formatDate(createdAt, 'MMM d, yyyy'), tone: 'default' }
  }
  if (stage === PROJECT_STAGE.PAUSED) {
    return { label: 'Paused', tone: 'default' }
  }

  // UIP planning is handled before the progress phases so a directorThinking
  // value emitted during UIP_PLANNING does not surface a video-generation label.
  if (stage === PROJECT_STAGE.UIP_PLANNING) {
    return { label: uipPlanningLabel(uip), tone: 'default' }
  }

  const videoLabel = videoGenerationLabel(progress)
  if (videoLabel) {
    return { label: videoLabel, tone: 'default' }
  }
  if (stage === PROJECT_STAGE.INITIALIZING) {
    return { label: 'Starting...', tone: 'default' }
  }
  return { label: 'Generating...', tone: 'default' }
}

function uipPlanningLabel(uip?: UipCardStatus): string {
  const phase = uip?.phase
  if (uip?.needsInput) {
    if (phase === 'script_review') {
      return 'Review your script'
    }
    if (phase === 'brand_review') {
      return 'Pick your brand assets'
    }
    return 'Needs your input'
  }
  if (phase === 'bootstrap_brand') {
    return 'Extracting brand...'
  }
  if (phase === 'bootstrap_script') {
    return 'Drafting script...'
  }
  if (phase === 'bootstrap_visual') {
    return 'Planning visuals...'
  }
  if (phase === 'refinement') {
    return 'Refining...'
  }
  if (uip?.thinking) {
    return 'Agent is thinking...'
  }
  return 'Planning your video...'
}

function videoGenerationLabel(progress?: {
  targetPhase: ProgressBulkItem['targetPhase']
  value: number
}): null | string {
  if (!progress) {
    return null
  }
  const pct = Math.round((progress.value ?? 0) * 100)
  const suffix = pct > 0 && pct < 100 ? ` ${pct}%` : ''
  switch (progress.targetPhase) {
    case 'directorThinking': {
      return 'Preparing...'
    }
    case 'hookSupervisorAgent': {
      return `Crafting hook${suffix}`
    }
    case 'scriptWriterAgent': {
      return `Writing script${suffix}`
    }
    case 'storyboardAgent': {
      return `Storyboarding${suffix}`
    }
    case 'storyLoaderAgent': {
      return `Gathering footage${suffix}`
    }
    case 'videoCrewAgent': {
      return `Generating video${suffix}`
    }
    default: {
      return null
    }
  }
}
