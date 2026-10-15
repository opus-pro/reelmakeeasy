import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import { atom } from 'jotai'

import { attachmentsAtom } from '@/atom/inputBox'

import { resolveAnchorAssetsFromAttachments } from '../../../anchor-assets/anchor-assets.utils'

// Uploaded story mode anchor assets (images attached as anchor assets).
export const getUploadedStoryModeAnchorAssetsAtom = createWeakMapFn(() => {
  const a = atom((get) => resolveAnchorAssetsFromAttachments(get(attachmentsAtom)))
  a.debugLabel = 'chatBoxV2/derived/uploadedStoryModeAnchorAssets'
  return a
})
