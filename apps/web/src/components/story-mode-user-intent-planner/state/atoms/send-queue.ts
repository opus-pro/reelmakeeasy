import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import { createAtom } from '@/lib/jotai-atom-utils'

import type { ActiveModalKind, DraftFileUpload } from './planner'

export interface ClientSendQueueItem {
  answerToMessageId?: string
  draftUploads: DraftFileUpload[]
  errorMessage?: string
  id: string
  message: string
  // Canvas modal open at send time; threaded through to the API request.
  sentFrom?: ActiveModalKind
  status: 'error' | 'pending' | 'sending'
}

export const getSendQueueAtom = createWeakMapFn(() =>
  createAtom<ClientSendQueueItem[]>([], 'storyModeUip/atom/sendQueue'),
)
