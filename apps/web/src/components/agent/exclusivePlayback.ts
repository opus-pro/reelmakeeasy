'use client'

import { atom } from 'jotai'

/** Pausers of the page's editor-engine players, by engine name. */
const enginePlayers = new Map<string, () => void>()

/** Registers an engine player so others can pause it; returns the unregister. */
export function registerEnginePlayer(name: string, pause: () => void): () => void {
  enginePlayers.set(name, pause)
  return () => {
    enginePlayers.delete(name)
  }
}

/**
 * One video sounds at a time on the agent page: whoever starts playing (an engine player
 * by its name, or a `<video>`) pauses every other engine player and media element.
 */
export function claimPlayback(by: { engine?: string; media?: EventTarget | null }) {
  for (const [name, pause] of enginePlayers) {
    if (name !== by.engine) pause()
  }
  for (const media of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
    if (media !== by.media && !media.paused) media.pause()
  }
}

/**
 * The one agent player that may run the editor engine right now (its id), or null. Each
 * engine is a whole WASM instance (memory, workers, a WebGL context) that destroying
 * doesn't fully free, so only the player the user last pressed play on gets one; the
 * others show their poster.
 */
export const liveEnginePlayerAtom = atom<null | string>(null)

/** Held by the agent Download that is preparing or starting an export (its id): one at a
 *  time on the page, since the editor state it loads holds one project. */
export const agentDownloadLockAtom = atom<null | string>(null)
