'use client'

import type { ReactNode } from 'react'

import { ProjectHistoryForOwner } from './ProjectHistoryForOwner'
import { ProjectHistoryForReplay } from './ProjectHistoryForReplay'

export interface ProjectHistoryProps {
  shareMode?: boolean
  topOverlay?: ReactNode
}

export default function ProjectHistory({ shareMode, topOverlay }: ProjectHistoryProps) {
  return shareMode ? (
    <ProjectHistoryForReplay topOverlay={topOverlay} />
  ) : (
    <ProjectHistoryForOwner />
  )
}
