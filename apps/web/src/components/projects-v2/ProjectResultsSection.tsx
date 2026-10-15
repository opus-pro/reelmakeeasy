'use client'

import { Project } from '@shared/types/api/project'
import { cn } from '@shared/ui'

import { ProjectLoadMoreBtn } from '@/components/ProjectLoadMoreBtn'

import { PROJECT_GRID_TEMPLATE_CLASSES } from './project-grid-template'
import { ProjectListCardV2 } from './ProjectListCardV2'

// Local structural types kept self-contained so this file has no dependency on
// the page and can be deleted or replaced without touching the type graph.
export type CardRecord = ProjectCardRecord
export type ProjectCardRecord = { kind: 'project'; project: Project }

interface ProjectResultsSectionProps {
  activeHasNextPage: boolean
  activeIsFetchingNextPage: boolean
  cardRecords: Array<CardRecord>
  error: unknown
  isLoading: boolean
  onFetchNextPage: () => void
  onOpenProject: (record: ProjectCardRecord) => void
}

export function ProjectResultsSection({
  activeHasNextPage,
  activeIsFetchingNextPage,
  cardRecords,
  error,
  isLoading,
  onFetchNextPage,
  onOpenProject,
}: Readonly<ProjectResultsSectionProps>) {
  if (isLoading) {
    return (
      <div className="py-12 text-center">
        <div className="text-lg text-gray-300">Loading projects...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-12">
        <div className="mx-auto max-w-xl rounded-lg border border-red-800 bg-red-900/20 p-4">
          <h2 className="font-semibold text-red-200">Error</h2>
          <p className="text-red-300">
            {error instanceof Error
              ? error.message
              : 'Failed to load projects. Please refresh and try again.'}
          </p>
        </div>
      </div>
    )
  }

  if (cardRecords.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-secondary text-lg">No projects found.</div>
      </div>
    )
  }

  return (
    <>
      <div className={cn(PROJECT_GRID_TEMPLATE_CLASSES, 'w-full place-content-start')}>
        {cardRecords.map((record) => (
          <ProjectListCardV2
            key={record.project.id}
            onOpenProject={() => onOpenProject(record)}
            project={record.project}
          />
        ))}
      </div>

      {activeHasNextPage && (
        <ProjectLoadMoreBtn
          className="pt-2"
          fetchNextPage={onFetchNextPage}
          hasNextPage={activeHasNextPage}
          isFetchingNextPage={activeIsFetchingNextPage}
        />
      )}
    </>
  )
}
