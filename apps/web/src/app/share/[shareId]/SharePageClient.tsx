'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

import ProjectPageClient from '@/app/projects/[projectId]/ProjectPageClient'
import { Loading } from '@/components/icons/core'
import { useProjectAtom } from '@/hooks/useProjects'
import { goBackSafe } from '@/util/go-back-safe'

import { StoryModeShareLayout } from './StoryModeShareLayout'

export default function SharePageClient() {
  const router = useRouter()
  const { projectId, projectInfo } = useProjectAtom()

  const handleClose = useCallback(() => {
    goBackSafe(router, '/')
  }, [router])

  if (!projectId || !projectInfo) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Loading className="size-12 animate-spin" />
      </div>
    )
  }

  if (projectInfo?.isLongTake && projectId) {
    return <StoryModeShareLayout onClose={handleClose} projectId={projectId} />
  }

  return <ProjectPageClient shareMode />
}
