import { atomWithPersistence } from '@/atom/common'

export type RecentProcessingCompletion = {
  dedupeKey: string
  projectId: string
}

// One entry per project with a not-yet-acknowledged completion; cleared when
// the user opens the project.
export const recentProcessingCompletionsAtom = atomWithPersistence<RecentProcessingCompletion[]>(
  'processing-notifications:recent',
  [],
)
