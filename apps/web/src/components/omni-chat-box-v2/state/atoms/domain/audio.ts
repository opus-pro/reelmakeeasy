import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import { createNullableAtom } from '@/lib/jotai-atom-utils'

export const getTriggerUploadFileAtom = createWeakMapFn(() =>
  createNullableAtom<() => void>('chatBoxV2/audio/triggerUploadFile'),
)

export const getAudioInputRefAtom = createWeakMapFn(() =>
  createNullableAtom<HTMLInputElement>('chatBoxV2/audio/audioInputRef'),
)
