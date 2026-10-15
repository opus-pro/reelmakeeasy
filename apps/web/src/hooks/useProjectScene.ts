'use client'

import { SceneListResponse } from '@shared/types/api'
import { useQuery } from '@tanstack/react-query'
import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'

import { projectProgressFamily, sceneListAtom } from '@/atom/project'
import { useProjectId } from '@/contexts/ProjectContext'

import { useApi } from './useApi'

export function useFetchProjectSceneList(
  projectId: null | string,
  extraDependency?: number | string,
) {
  const { fetchApiDomain: fetchWithProjectId } = useApi()

  const {
    data: sceneList,
    error,
    isLoading,
    refetch,
  } = useQuery({
    queryFn: async () => {
      const response = await fetchWithProjectId<SceneListResponse>(
        `/api/project/${projectId}/scene`,
      )
      return response.data?.data
    },
    queryKey: ['project-scenes', projectId, extraDependency],
    enabled: !!projectId,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  })

  return {
    error,
    isLoading,
    sceneList,
    refetch,
  }
}

export function useProjectAndSceneData() {
  const { projectId } = useProjectId()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const progress = useAtomValue(projectProgressFamily(projectId || ''))

  const { sceneList: fetchedSceneList, isLoading } = useFetchProjectSceneList(
    projectId,
    progress?.scenePreviewUrl,
  )
  const [sceneList, setSceneList] = useAtom(sceneListAtom)

  useEffect(() => {
    if (!fetchedSceneList || isLoading) {
      return
    }
    setSceneList(fetchedSceneList)
    if ((selectedIndex == null || selectedIndex === -1) && fetchedSceneList.length > 0) {
      setSelectedIndex(0)
    }
  }, [projectId, fetchedSceneList, setSceneList, isLoading])

  return {
    sceneList,
    selectedIndex,
    setSelectedIndex,
    isLoading,
  }
}
