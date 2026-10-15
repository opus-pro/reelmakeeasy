import { createEventKey, Events } from '@reelmakeeasy/common/events'
import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import type { AssetRef, StoryboardShot } from '../../state-types'

export const getPlannerEvents = createWeakMapFn(() => new Events())

export const fillTextWithAssetsEvent =
  createEventKey<[payload: { assets: AssetRef[]; text: string }]>('fill-text-with-assets')

export const selectAssetEvent = createEventKey<[asset: AssetRef]>('select-asset')

export const selectShotEvent = createEventKey<[shot: StoryboardShot]>('select-shot')

export const selectTextEvent = createEventKey<[payload: { text: string }]>('select-text')
