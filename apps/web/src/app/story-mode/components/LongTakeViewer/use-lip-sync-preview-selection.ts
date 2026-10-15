import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ViewerData } from '../../hook/useLongTakeViewerData'

import {
  getLipSyncPreviewTransitions,
  resolveAnyLipSyncPreviewEnabled,
  resolveLipSyncPreviewSnapshot,
} from './StorySequencer/engine'

export function useLipSyncPreviewControls(params: {
  hasProjectLipSyncVariants: boolean
  lipSyncPreviewTransitions: ReturnType<typeof getLipSyncPreviewTransitions>
  projectId: string
  projectLipSyncEnabled: boolean
  setProjectLipSyncEnabled: (enabled: boolean) => void
}) {
  const {
    hasProjectLipSyncVariants,
    lipSyncPreviewTransitions,
    projectId,
    projectLipSyncEnabled,
    setProjectLipSyncEnabled,
  } = params
  const [lipSyncPreviewOverrides, setLipSyncPreviewOverrides] = useState<Record<string, boolean>>(
    {},
  )

  useEffect(() => {
    // On project switch, clear the preview overrides.
    setLipSyncPreviewOverrides({})
  }, [projectId])

  const lipSyncPreviewEnabled = useMemo(
    () =>
      hasProjectLipSyncVariants
        ? projectLipSyncEnabled
        : resolveAnyLipSyncPreviewEnabled(lipSyncPreviewTransitions, lipSyncPreviewOverrides),
    [
      hasProjectLipSyncVariants,
      lipSyncPreviewOverrides,
      lipSyncPreviewTransitions,
      projectLipSyncEnabled,
    ],
  )
  const lipSyncPreviewSnapshot = useMemo(
    () => resolveLipSyncPreviewSnapshot(lipSyncPreviewTransitions, lipSyncPreviewOverrides),
    [lipSyncPreviewOverrides, lipSyncPreviewTransitions],
  )
  const handleLipSyncPreviewChange = useCallback((transitionId: string, enabled: boolean) => {
    setLipSyncPreviewOverrides((prev) => {
      if (prev[transitionId] === enabled) {
        return prev
      }
      return { ...prev, [transitionId]: enabled }
    })
  }, [])
  const handleAllLipSyncPreviewChange = useCallback(
    (enabled: boolean) => {
      if (hasProjectLipSyncVariants) {
        setProjectLipSyncEnabled(enabled)
        return
      }
      let changed = false
      const next = { ...lipSyncPreviewOverrides }
      for (const transition of lipSyncPreviewTransitions) {
        if (next[transition.transitionId] !== enabled) {
          next[transition.transitionId] = enabled
          changed = true
        }
      }
      if (changed) {
        setLipSyncPreviewOverrides(next)
      }
    },
    [
      hasProjectLipSyncVariants,
      lipSyncPreviewOverrides,
      lipSyncPreviewTransitions,
      setProjectLipSyncEnabled,
    ],
  )

  return {
    handleAllLipSyncPreviewChange,
    handleLipSyncPreviewChange,
    lipSyncPreviewEnabled,
    lipSyncPreviewOverrides,
    lipSyncPreviewSnapshot,
  }
}

export function useProjectLipSyncVideoSelection(projectId: string, data: ViewerData) {
  const [projectLipSyncEnabled, setProjectLipSyncEnabled] = useState(true)

  useEffect(() => {
    setProjectLipSyncEnabled(true)
  }, [projectId])

  return useMemo(() => {
    const hasProjectLipSyncVariants = Boolean(
      data.lipSyncVideoVariants?.baseVideoUrl && data.lipSyncVideoVariants?.lipSyncVideoUrl,
    )
    const selectedVideoUrl =
      hasProjectLipSyncVariants && !projectLipSyncEnabled
        ? (data.lipSyncVideoVariants?.baseVideoUrl ?? data.videoUrl)
        : data.videoUrl
    const selectedWatermarkVideoUrl =
      hasProjectLipSyncVariants && !projectLipSyncEnabled
        ? (data.lipSyncVideoVariants?.baseWatermarkVideoUrl ??
          data.lipSyncVideoVariants?.baseVideoUrl ??
          data.watermarkVideoUrl)
        : data.watermarkVideoUrl

    return {
      hasProjectLipSyncVariants,
      projectLipSyncEnabled,
      selectedVideoUrl,
      selectedWatermarkVideoUrl,
      setProjectLipSyncEnabled,
    }
  }, [
    data.lipSyncVideoVariants?.baseVideoUrl,
    data.lipSyncVideoVariants?.baseWatermarkVideoUrl,
    data.lipSyncVideoVariants?.lipSyncVideoUrl,
    data.videoUrl,
    data.watermarkVideoUrl,
    projectLipSyncEnabled,
  ])
}
