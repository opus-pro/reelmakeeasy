import type { LongTakeTransition } from '@shared/types/api/long-take'

import { createLongTakeStorage } from './storage'

/** A regenerated clip as the editor state stores it (the generation item's render fields). */
export type RegeneratedTransition = Pick<
  LongTakeTransition,
  | 'endMs'
  | 'fromShotId'
  | 'prompt'
  | 'startMs'
  | 'toShotId'
  | 'transitionId'
  | 'videoHeight'
  | 'videoUri'
  | 'videoWidth'
>

/** The stored list with each regenerated clip swapped in by id; unknown ids are ignored. */
export function mergeRegeneratedTransitions(
  stored: LongTakeTransition[],
  regenerated: RegeneratedTransition[],
): LongTakeTransition[] {
  const byId = new Map(regenerated.map((t) => [t.transitionId, t]))
  return stored.map((t) => {
    const next = byId.get(t.transitionId)
    return next ? { ...t, ...next } : t
  })
}

/** Writes regenerated clips into `long_take/transition_videos.json` (the editor's canonical state). */
export async function commitRegeneratedTransitions(params: {
  projectId: string
  transitions: RegeneratedTransition[]
}): Promise<{ written: number }> {
  const storage = createLongTakeStorage(params.projectId)
  const stored =
    (await storage.readJsonFile<LongTakeTransition[]>('long_take/transition_videos.json')) ?? []
  const merged = mergeRegeneratedTransitions(stored, params.transitions)
  await storage.writeJsonFile('long_take/transition_videos.json', merged)
  return {
    written: params.transitions.filter((t) => stored.some((s) => s.transitionId === t.transitionId))
      .length,
  }
}
