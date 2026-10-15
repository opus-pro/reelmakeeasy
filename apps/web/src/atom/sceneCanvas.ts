import { EmbeddedBlockMessage } from '@shared/types/chat/message-embedded-block'
import { atom } from 'jotai'

export type SceneLoaderStage = 'init-loading' | 'scene-ready'

export const SceneLoaderStageAtom = atom<SceneLoaderStage>('init-loading')
SceneLoaderStageAtom.debugLabel = 'SceneLoaderStageAtom'

// order:
// 1. transcript
// 2. source
// 3.1 viral-hooks
// 3.2 storyboard
// 4. video
export type SceneStageLayerType =
  | 'default'
  | 'source'
  | 'storyboard'
  | 'transcript'
  | 'video'
  | 'viral-hook'

export const SceneStageLayerTypeAtom = atom<SceneStageLayerType>('default')
SceneStageLayerTypeAtom.debugLabel = 'SceneStageLayerTypeAtom'

export const SceneStageMessageAtom = atom<EmbeddedBlockMessage>()
SceneStageMessageAtom.debugLabel = 'SceneStageMessageAtom'

export const SceneStageHookIndexAtom = atom<number>(-1)
SceneStageHookIndexAtom.debugLabel = 'SceneStageHookIndexAtom'

export const isEditorModeAtom = atom<boolean>(false)
isEditorModeAtom.debugLabel = 'isEditorModeAtom'

export const userInteractionAtom = atom<boolean>(false)
userInteractionAtom.debugLabel = 'userInteractionAtom'
