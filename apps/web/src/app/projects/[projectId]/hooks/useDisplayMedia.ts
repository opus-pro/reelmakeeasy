import { EmbeddedBlockMessage } from '@shared/types/chat/message-embedded-block'
import { useSetAtom } from 'jotai'

import { SceneStageLayerTypeAtom, SceneStageMessageAtom } from '@/atom/sceneCanvas'
import { useRefCallback } from '@/hooks/use-ref-callback'

export function useDisplayMedia() {
  const setSceneLayerType = useSetAtom(SceneStageLayerTypeAtom)
  const setSceneStageMessage = useSetAtom(SceneStageMessageAtom)

  const playCard = useRefCallback((msg: EmbeddedBlockMessage) => {
    if (msg.type === 'embedded-video') {
      setSceneLayerType('video')
      setSceneStageMessage(msg)
    }
    if (msg.type === 'embedded-storyboard') {
      setSceneLayerType('storyboard')
      setSceneStageMessage(msg)
    }
    if (msg.type === 'embedded-source') {
      setSceneLayerType('source')
      setSceneStageMessage(msg)
    }
  })

  return {
    playCard,
  }
}
