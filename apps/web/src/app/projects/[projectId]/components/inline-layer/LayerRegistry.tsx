import { Dialog } from '@shared/ui'
import { useAtom } from 'jotai'
import { memo, useEffect, useMemo } from 'react'

import { confirmCardDialogOpenAtom } from '@/atom/home'
import { SceneStageLayerTypeAtom } from '@/atom/sceneCanvas'

import { useSourceData } from '../embedded-block/hooks/useSourceData'
import SceneCanvas from '../scene-canvas'

import SourceLayer from './SourceLayer'

export const LayerRegistry: React.FC = memo(() => (
  <div className="relative flex h-full flex-1 flex-col">
    <LayerRegistryInner />
  </div>
))

LayerRegistry.displayName = 'LayerRegistry'

const LayerRegistryInner: React.FC = memo(() => {
  const [layerType, setLayerType] = useAtom(SceneStageLayerTypeAtom)
  const [confirmCardDialogOpen, setConfirmCardDialogOpen] = useAtom(confirmCardDialogOpenAtom)
  const showStageLayer = ['source', 'storyboard'].includes(layerType)
  const sourceData = useSourceData()
  const sourceCount = sourceData.length

  // Sync dialog open state with layerType
  useEffect(() => {
    setConfirmCardDialogOpen(showStageLayer)
  }, [showStageLayer])

  const dialogConfig = useMemo<{
    description: null | string
    title: string
  }>(() => {
    if (layerType === 'source') {
      return {
        title: 'Search results',
        description: `${sourceCount} related references and articles found`,
      }
    }
    return { title: 'None title', description: 'None description' }
  }, [layerType, sourceCount])
  return (
    <>
      <div className="font-geist-sans relative flex h-full min-h-0 flex-1 flex-col text-base">
        <SceneCanvas />
      </div>
      <Dialog
        classNames={{
          content:
            'w-[55dvw] max-w-[90dvw] max-h-[90dvh] grid-rows-[auto_1fr] gap-y-6 border-none bg-menu-background backdrop-blur-2xl',
        }}
        footer={null}
        onCancel={() => {
          setConfirmCardDialogOpen(false)
          setTimeout(() => {
            setLayerType('default')
          }, 200)
        }}
        open={confirmCardDialogOpen}
        {...dialogConfig}
      >
        <div className="size-full min-h-0 overflow-hidden">
          {layerType === 'source' && <SourceLayer />}
        </div>
      </Dialog>
    </>
  )
})

LayerRegistryInner.displayName = 'LayerRegistryInner'
