import { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { useAtomValue } from 'jotai'
import React from 'react'

import { useRenderMainEngine } from '../render-engine-sdk'
import { editorUiStore } from '../stores/editor-ui.store'

import HardwareAccelerationBanner from './HardwareAccelerationBanner'

const CANVAS_ID = 'render-canvas'

interface EditorCanvasProps {
  renderPlan: RenderPlan
}

export const EditorCanvas = React.memo(({ renderPlan }: EditorCanvasProps) => {
  const canvasSize = useAtomValue(editorUiStore.canvasSize)
  const canvasScale = useAtomValue(editorUiStore.canvasScale)

  const { hardwareAccelerationUnavailable } = useRenderMainEngine({
    videoCanvasId: CANVAS_ID,
    renderPlan: renderPlan
      ? {
          id: '#Root',
          tracks: renderPlan.tracks,
          defaultFontGzipPath: renderPlan.defaultFontGzipPath,
          videoInfo: {
            id: '#VideoInfo',
            width: renderPlan.videoInfo.width,
            height: renderPlan.videoInfo.height,
            frameRate: renderPlan.videoInfo.frameRate,
          },
          audioInfo: renderPlan.audioInfo
            ? {
                id: '#AudioInfo',
                channels: renderPlan.audioInfo.channels,
                sampleRate: renderPlan.audioInfo.sampleRate,
              }
            : {
                id: '#AudioInfo',
                sampleRate: 48000,
                channels: 2,
              },
        }
      : undefined,
  })

  return (
    <>
      <canvas
        className="absolute inset-0 size-full"
        height={canvasSize.height * canvasScale}
        id={CANVAS_ID}
        onContextMenu={(e) => e.preventDefault()}
        width={canvasSize.width * canvasScale}
      />
      <HardwareAccelerationBanner
        hardwareAccelerationUnavailable={hardwareAccelerationUnavailable}
      />
    </>
  )
})
