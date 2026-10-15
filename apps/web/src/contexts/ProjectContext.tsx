'use client'
import { useAtom, useAtomValue } from 'jotai'
import { usePathname } from 'next/navigation'
import React, { useEffect } from 'react'

import { projectIdAtom } from '@/atom/project'
import { shareIdAtom } from '@/atom/share'
import { Loading } from '@/components/icons/core'
import { ShareAccessDeniedModal } from '@/components/ShareAccessDeniedModal'
import { useProjectByShareId } from '@/hooks/useShareProject'

// Create context for project-related data
const ProjectContext = React.createContext<{ projectId: string }>({ projectId: '' })

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { shareId, isPending, projectId, isAccessDenied } = useSyncProjectOrShareId()

  // Show loading while fetching share data
  const isLoading = isPending && !!shareId

  if (isLoading) {
    return (
      <div className="bg-background flex h-screen w-screen items-center justify-center">
        <Loading className="size-12 animate-spin" />
      </div>
    )
  }

  return (
    <ProjectContext.Provider value={{ projectId }}>
      {children}
      {isAccessDenied && <ShareAccessDeniedModal />}
    </ProjectContext.Provider>
  )
}
export function useProjectContext() {
  return React.useContext(ProjectContext)
}
export function useProjectId() {
  const projectId = useAtomValue(projectIdAtom)
  return { projectId }
}

const PROJECT_LIST_SEGMENTS = ['videos', 'story-mode']

function useSyncProjectOrShareId() {
  const [projectId, setProjectId] = useAtom(projectIdAtom)
  const path = usePathname()
  const projectIdFromParams = path.match(/^\/(p|editor)\/([^/]+)$/)?.[2]
  const projectsPageMatch = path.match(/^\/projects\/([^/]+)$/)?.[1]
  const projectIdFromProjectsPage =
    projectsPageMatch && !PROJECT_LIST_SEGMENTS.includes(projectsPageMatch)
      ? projectsPageMatch
      : null
  const shareIdFromParams = path.match(/^\/share\/([^/]+)$/)?.[1]
  const [shareId, setShareId] = useAtom(shareIdAtom)

  // Use shareIdFromParams directly for the query to avoid timing issues
  const effectiveShareId = shareId || shareIdFromParams || ''
  const { project, isPending, isError } = useProjectByShareId(effectiveShareId)

  useEffect(() => {
    if (!effectiveShareId) {
      return
    }
    setProjectId(project?.id ?? '')
  }, [project?.id, effectiveShareId, setProjectId])

  useEffect(() => {
    if (projectIdFromProjectsPage) {
      setProjectId(projectIdFromProjectsPage)
      return
    }
    if (!projectIdFromParams) {
      return
    }
    const id = projectIdFromParams as string
    setProjectId(id)
  }, [projectIdFromParams, projectIdFromProjectsPage, setProjectId])

  useEffect(() => {
    if (shareIdFromParams) {
      setShareId(shareIdFromParams)
    } else if (shareId) {
      // Clear stale share ID when navigating away from share page
      setShareId('')
    }
  }, [shareIdFromParams, setShareId])

  // Show the not-found modal on any terminal share-fetch error, not just 403/404:
  // isError settles true only after retries are exhausted, so a bad link or a 500
  // that never resolves surfaces the modal instead of an endless loading spinner.
  const isOnSharePage = !!shareIdFromParams
  const showAccessDenied = isOnSharePage && isError

  return { projectId, shareId: effectiveShareId, isPending, isAccessDenied: showAccessDenied }
}
