import { useAtom } from 'jotai'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'

import { sidebarWidthAtom } from '@/atom/ui'
import { useRefCallback } from '@/hooks/use-ref-callback'

const PANEL_CONSTRAINTS = {
  sidebar: { minWidth: 400, maxWidth: 700 },
  main: { minWidth: 960 },
  layoutPadding: 24,
}

const DEFAULT_VIEWPORT_WIDTH = 1440

const calculateSizePercent = (px: number, availableWidth: number) =>
  Math.round((px / availableWidth) * 100)

const calculatePanelSizes = (windowWidth: number) => {
  const availableWidth = windowWidth - PANEL_CONSTRAINTS.layoutPadding
  const { sidebar, main } = PANEL_CONSTRAINTS

  const minSize = calculateSizePercent(sidebar.minWidth, availableWidth)
  const maxFromSidebar = calculateSizePercent(sidebar.maxWidth, availableWidth)
  const maxFromMainConstraint = Math.max(
    0,
    calculateSizePercent(availableWidth - main.minWidth, availableWidth),
  )

  return {
    minSize: Math.max(0, minSize),
    maxSize: Math.max(0, Math.min(maxFromSidebar, maxFromMainConstraint)),
  }
}

const getViewportWidth = () =>
  typeof window === 'undefined' ? DEFAULT_VIEWPORT_WIDTH : window.innerWidth

export const usePanelSizeConfig = (): {
  handleResizeChange: (value: number) => void
  maxSize: number
  minSize: number
  sidebarWidth: number
} => {
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom)
  const [panelSizes, setPanelSizes] = useState(() => calculatePanelSizes(getViewportWidth()))

  const updatePanelSizes = useCallback(() => {
    setPanelSizes(calculatePanelSizes(getViewportWidth()))
  }, [])

  useLayoutEffect(() => {
    updatePanelSizes()
    window.addEventListener('resize', updatePanelSizes)
    return () => window.removeEventListener('resize', updatePanelSizes)
  }, [updatePanelSizes])

  useLayoutEffect(() => {
    if (sidebarWidth === 0) {
      return
    }
    if (sidebarWidth > panelSizes.maxSize) {
      setSidebarWidth(panelSizes.maxSize)
    }
  }, [sidebarWidth, panelSizes.maxSize, setSidebarWidth])

  const effectiveSidebarWidth = useMemo(() => {
    if (sidebarWidth === 0) {
      return panelSizes.maxSize
    }
    return sidebarWidth
  }, [sidebarWidth, panelSizes.maxSize])

  const handleResizeChange = useRefCallback((value: number) => {
    setSidebarWidth(Math.round(value))
  })

  return {
    ...panelSizes,
    sidebarWidth: effectiveSidebarWidth,
    handleResizeChange,
  }
}
