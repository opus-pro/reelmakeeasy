// In-memory client state derived from API data. Does not cross the network
// boundary - neither produced nor consumed by any backend.

export type StoryKeyframeSegment = {
  endMs: number
  keyframeUrl: string
  kind: 'keyframe'
  shotId: string
  startMs: number
  thumbnailUrl?: string
}

export type StorySegment = StoryKeyframeSegment | StoryTransitionSegment

export type StoryTransitionSegment = {
  baseVideoUri?: string
  endMs: number
  kind: 'transition'
  lipSyncEnabled?: boolean
  lipSyncVideoUri?: string
  startMs: number
  transitionId: string
  videoHeight?: number
  videoUri: string
  videoWidth?: number
}
