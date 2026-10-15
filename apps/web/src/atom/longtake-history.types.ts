// In-memory undo/redo state for the long-take editor. The patch / snapshot
// shapes now live in @reelmakeeasy/common so the backend can replay a stored draft;
// they are re-exported here so existing in-app imports keep resolving.

import type { LongTakeSnapshot } from '@reelmakeeasy/common/long-take/editor-history-replay'

export type {
  KeyframeFrameRole,
  KeyframePatch,
  LongTakeSnapshot,
  TransitionPatch,
} from '@reelmakeeasy/common/long-take/editor-history-replay'

export interface LongTakeHistory {
  baseRevision?: string
  future: LongTakeSnapshot[]
  past: LongTakeSnapshot[]
  projectId: string
}
