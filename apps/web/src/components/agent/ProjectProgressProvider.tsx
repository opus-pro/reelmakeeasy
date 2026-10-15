'use client'

import { type ReactNode, useCallback, useEffect, useState } from 'react'

import {
  type ProjectProgress,
  ProjectProgressContext,
  usePolledProjectProgress,
} from './useProjectProgress'

type Report = (projectId: string, progress: ProjectProgress) => void

/** Runs one project's poll and reports every new progress up to the provider. */
function ProjectPoller({ onChange, projectId }: { onChange: Report; projectId: string }) {
  const progress = usePolledProjectProgress(projectId)
  useEffect(() => {
    onChange(projectId, progress)
  }, [onChange, progress, projectId])
  return null
}

/**
 * Polls each of `projectIds` once (`usePolledProjectProgress`) and shares the result with
 * every `useProjectProgress` below it, so the chat card and the storyboard panel read the
 * same poll.
 */
export function ProjectProgressProvider({
  children,
  projectIds,
}: {
  children: ReactNode
  projectIds: readonly string[]
}) {
  const [byId, setById] = useState<ReadonlyMap<string, ProjectProgress>>(() => new Map())

  const report = useCallback<Report>((projectId, progress) => {
    setById((prev) => {
      if (prev.get(projectId) === progress) return prev
      const next = new Map(prev)
      next.set(projectId, progress)
      return next
    })
  }, [])

  return (
    <ProjectProgressContext.Provider value={byId}>
      {projectIds.map((projectId) => (
        <ProjectPoller key={projectId} onChange={report} projectId={projectId} />
      ))}
      {children}
    </ProjectProgressContext.Provider>
  )
}
