'use client'

import { PROJECT_STAGE } from '@shared/types/enums/project'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useMarkProjectViewed } from '@/components/ongoing-projects/hooks/useMarkProjectViewed'
import { useCdnOrigin } from '@/hooks/useCdnOrigin'
import { useMutateQuery } from '@/hooks/useMutateQuery'
import { useMergeProjects, useProjectAtom } from '@/hooks/useProjects'
import { goBackSafe } from '@/util/go-back-safe'

import { LongTakeViewer } from '../components/LongTakeViewer'
import type { SiblingProject } from '../components/LongTakeViewer/sibling-types'

export function LongTakeViewerPage() {
  const params = useParams()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { setQuery, removeQuery } = useMutateQuery()

  const projectId = useMemo(() => {
    // Try to get projectId from params first
    const paramValue =
      typeof params?.projectId === 'string' ? params.projectId : params?.projectId?.[0]
    if (paramValue && paramValue !== 'placeholder') {
      return paramValue
    }
    // Fallback: extract from pathname (handles static export edge cases)
    const fromPath = pathname?.split('/').findLast(Boolean)
    return fromPath && fromPath !== 'placeholder' ? fromPath : ''
  }, [params?.projectId, pathname])

  const { projectInfo } = useProjectAtom()
  const { mergedProjects } = useMergeProjects()
  const cdnOrigin = useCdnOrigin()

  const storyModeProjects = useMemo(
    () => mergedProjects.filter((project) => project.isLongTake),
    [mergedProjects],
  )

  const { nextProjectId, prevProjectId } = useMemo(() => {
    const index = storyModeProjects.findIndex((project) => project.id === projectId)
    if (index === -1) {
      return { nextProjectId: null, prevProjectId: null }
    }
    return {
      nextProjectId: storyModeProjects[index + 1]?.id ?? null,
      prevProjectId: index > 0 ? (storyModeProjects[index - 1]?.id ?? null) : null,
    }
  }, [storyModeProjects, projectId])

  const siblings = useMemo<SiblingProject[]>(
    () =>
      storyModeProjects.map((project) => {
        const isFinishedLongTake = project.stage === PROJECT_STAGE.FINISHED
        const thumbnailUrl =
          project.resultVideoThumbnail ||
          (isFinishedLongTake
            ? `${cdnOrigin}/projects/${project.id}/long_take/keyframes/LT_S1.png`
            : undefined)
        return {
          id: project.id,
          thumbnailUrl,
          title: project.name,
        }
      }),
    [storyModeProjects, cdnOrigin],
  )

  useMarkProjectViewed([{ source: 'project', project: projectInfo }])

  // On the statically-exported [projectId] route, history.replaceState updates the
  // URL but does not refresh useSearchParams when reached via client-side navigation,
  // so the view is driven by local state (kept in sync with the URL via popstate).
  const [viewUip, setViewUip] = useState(() => searchParams.get('view_uip') === '1')
  // Read once -- it describes how this view was entered: the /projects/[projectId]
  // gate already dismissed its planner, so without this the finished project
  // remounts the canvas and the gate needs two clicks.
  const [enteredFromCanvas] = useState(() => searchParams.get('from') === 'canvas')

  useEffect(() => {
    const syncFromUrl = () =>
      setViewUip(new URLSearchParams(window.location.search).get('view_uip') === '1')
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])

  const handleClose = useCallback(() => {
    // Read from the live URL, not useSearchParams: on this statically-exported
    // route it does not refresh after removeQuery drops firstView (see note
    // above), so a stale '1' would keep force-pushing /projects post-close.
    if (new URLSearchParams(window.location.search).get('firstView') === '1') {
      router.push('/projects')
      return
    }
    goBackSafe(router, '/projects')
  }, [router])

  const handleViewChatHistory = useCallback(() => {
    setViewUip(true)
    setQuery({ view_uip: '1' }, { mode: 'replace' })
  }, [setQuery])

  const handleCloseUipView = useCallback(() => {
    setViewUip(false)
    // Also drop firstView: once the user acts on the post-render video-ready
    // gate the "just submitted" framing is over, so close/back should behave
    // normally (goBackSafe) rather than force-push to /projects.
    removeQuery(['view_uip', 'firstView'], { mode: 'replace' })
  }, [removeQuery])

  const handlePrev = useCallback(() => {
    if (!prevProjectId) {
      return
    }
    router.replace(`/story-mode/${prevProjectId}`)
  }, [prevProjectId, router])

  const handleNext = useCallback(() => {
    if (!nextProjectId) {
      return
    }
    router.replace(`/story-mode/${nextProjectId}`)
  }, [nextProjectId, router])

  const handleSelectSibling = useCallback(
    (siblingId: string) => {
      if (siblingId === projectId) {
        return
      }
      router.replace(`/story-mode/${siblingId}`)
    },
    [projectId, router],
  )

  if (!projectId) {
    return (
      <div className="flex h-screen items-center justify-center text-secondary">
        Invalid project ID
      </div>
    )
  }

  return (
    <LongTakeViewer
      enteredFromCanvas={enteredFromCanvas}
      hasNext={Boolean(nextProjectId)}
      hasPrev={Boolean(prevProjectId)}
      onClose={handleClose}
      onCloseUipView={handleCloseUipView}
      onNext={handleNext}
      onPrev={handlePrev}
      onSelectSibling={handleSelectSibling}
      onViewChatHistory={handleViewChatHistory}
      projectId={projectId}
      siblings={siblings}
      viewUip={viewUip}
    />
  )
}
