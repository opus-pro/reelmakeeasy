import { atom } from 'jotai'

/**
 * How many times the chat rebuilt each project's video (`render_video`) while this page
 * was open: the players reload the file and the storyboard re-reads the clips. Counted
 * from the event stream, which replays, so a reload lands on the same count.
 */
export const renderedVersionsAtom = atom<Record<string, number>>({})

export const noteVideoRenderedAtom = atom(null, (get, set, projectId: string) => {
  const versions = get(renderedVersionsAtom)
  set(renderedVersionsAtom, { ...versions, [projectId]: (versions[projectId] ?? 0) + 1 })
})
