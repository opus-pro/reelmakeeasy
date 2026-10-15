import { createStore } from 'jotai'

import { noteVideoRenderedAtom, renderedVersionsAtom } from './renderedVersions'

describe('renderedVersionsAtom', () => {
  it("counts each project's rebuilds separately, from zero", () => {
    const store = createStore()
    expect(store.get(renderedVersionsAtom)).toEqual({})
    for (const projectId of ['p1', 'p1', 'p2']) store.set(noteVideoRenderedAtom, projectId)
    expect(store.get(renderedVersionsAtom)).toEqual({ p1: 2, p2: 1 })
  })
})
