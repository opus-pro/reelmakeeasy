'use client'

import { SceneDataForCanvas } from '@shared/types/api'
import React, { createContext, useContext, useMemo } from 'react'

import { useProjectAndSceneData } from '@/hooks/useProjectScene'

export interface SceneDataContextValue {
  isLoading: boolean
  sceneList: SceneDataForCanvas[]
  selectedIndex: number
  setSelectedIndex: (index: number) => void
}

const SceneDataContext = createContext<null | SceneDataContextValue>(null)

export function SceneDataProvider({ children }: { children: React.ReactNode }) {
  const data = useProjectAndSceneData()

  const value = useMemo(
    () => ({
      sceneList: data.sceneList,
      selectedIndex: data.selectedIndex,
      setSelectedIndex: data.setSelectedIndex,
      isLoading: data.isLoading,
    }),
    [data.sceneList, data.selectedIndex, data.setSelectedIndex, data.isLoading],
  )

  return <SceneDataContext.Provider value={value}>{children}</SceneDataContext.Provider>
}

export function useSceneData(): SceneDataContextValue {
  const context = useContext(SceneDataContext)
  if (!context) {
    throw new Error('useSceneData must be used within a SceneDataProvider')
  }
  return context
}

export function useSceneDataOptional(): null | SceneDataContextValue {
  return useContext(SceneDataContext)
}
