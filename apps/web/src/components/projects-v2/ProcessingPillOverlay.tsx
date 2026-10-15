'use client'

import type { ProcessingRunPill } from '@/components/projects-v2/project-card-processing-run'
import { ProjectCardStatusPill } from '@/components/projects-v2/ProjectCardStatusPill'

/**
 * The background-job status pill centered over the thumbnail.
 *
 * Lives outside the card because ProjectCardStatusPill is deliberately
 * position-agnostic (the consumer owns placement) and the card itself sits at
 * the max-lines ceiling.
 */
export function ProcessingPillOverlay({ pill }: { pill: null | ProcessingRunPill }) {
  if (!pill) {
    return null
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center px-2">
      <ProjectCardStatusPill label={pill.label} variant={pill.variant} />
    </div>
  )
}
