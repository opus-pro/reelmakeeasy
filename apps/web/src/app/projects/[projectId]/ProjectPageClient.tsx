'use client'

import { PROJECT_STAGE } from '@shared/types/enums/project'
import { useUnmount } from 'ahooks'
import { useSetAtom } from 'jotai'
import { useRouter, useSearchParams } from 'next/navigation'
import { type ReactNode } from 'react'

import {
  SceneStageHookIndexAtom,
  SceneStageLayerTypeAtom,
  SceneStageMessageAtom,
} from '@/atom/sceneCanvas'
import { useMarkProjectViewed } from '@/components/ongoing-projects/hooks/useMarkProjectViewed'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useProjectAtom } from '@/hooks/useProjects'
import { goBackSafe } from '@/util/go-back-safe'

import ProjectHistory from './components/ProjectHistory'
import UipPlannerSection from './UipPlannerSection'

export default function ProjectPageClient({
  shareMode,
  topOverlay,
}: {
  shareMode?: boolean
  topOverlay?: ReactNode
}) {
  const { projectInfo } = useProjectAtom()
  const router = useRouter()
  const searchParams = useSearchParams()

  useMarkProjectViewed([{ source: 'project', project: projectInfo }])
  const setSceneLayerType = useSetAtom(SceneStageLayerTypeAtom)
  const setSceneStageMessage = useSetAtom(SceneStageMessageAtom)
  const setSceneStageHookIndex = useSetAtom(SceneStageHookIndexAtom)
  const reset = useRefCallback(() => {
    setSceneLayerType('default')
    setSceneStageMessage(undefined)
    setSceneStageHookIndex(-1)
  })

  useUnmount(() => {
    reset()
  })

  if (!projectInfo) {
    return null
  }

  // rerunFrom marks a regenerate, whose seeded session is a history snapshot
  // nothing drives, so mounting the planner would put a stale session beside an
  // actively rendering video. Mirrors uip-planner-gate.util.ts.
  const showUipPlannerSection =
    !projectInfo.rerunFrom && projectInfo.stage === PROJECT_STAGE.UIP_PLANNING

  if (showUipPlannerSection) {
    const isFirstView = searchParams.get('firstView') === '1'
    const handleClose = () => {
      if (isFirstView) {
        router.push('/projects')
      } else {
        goBackSafe(router, '/projects')
      }
    }
    return (
      <UipPlannerSection
        isVideoReady={Boolean(projectInfo.resultVideo)}
        onClose={handleClose}
        onVideoThumbnailClick={() => router.push(`/story-mode/${projectInfo.id}?from=canvas`)}
        outputVideoUrl={projectInfo.resultVideo}
        projectId={projectInfo.id}
        thumbnailUrl={projectInfo.resultVideoThumbnail}
      />
    )
  }

  return <ProjectHistory shareMode={shareMode} topOverlay={topOverlay} />
}
