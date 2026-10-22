'use client'

import { type LibrarySound, soundPlayback } from '@shared/types/api/sound-library'

export type PlayingSound = { stop: () => void }

let context: AudioContext | null = null
const audioContext = () => {
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume()
  return context
}

/**
 * Creates or wakes the page's audio, inside a click or key press: a browser (Safari) keeps audio
 * that first starts outside one silent.
 */
export function unlockAudio(): void {
  try {
    audioContext()
  } catch {
    // No Web Audio: sounds use their element's own volume.
  }
}

/** How long a library sound plays: its trimmed part. */
export function soundLengthSec(sound: LibrarySound): number {
  const { endSec, startSec } = soundPlayback(sound)
  return Math.max(0, endSec - startSec)
}

/**
 * Plays a library sound the way the export will: only its trimmed part, at its level (a level
 * above 100% goes through a Web Audio gain, which an <audio> element's volume can't do), times
 * `level` (the short's music level). `loop` repeats the part until stopped. `offsetSec` starts it
 * that far into the part (a looping part wraps around).
 */
export function playSoundPart(
  sound: LibrarySound,
  opts: { level?: number; loop?: boolean; offsetSec?: number; onEnd?: () => void } = {},
): PlayingSound {
  const { endSec, startSec, volume } = soundPlayback(sound)
  const length = endSec - startSec
  const loop = !!opts.loop && length > 0
  const offset = Math.max(0, opts.offsetSec ?? 0)
  // Loading takes a moment: the sound starts as far in as it would be by then, so it stays in
  // step with the picture (and a short one that's already over by then doesn't play at all).
  const asked = performance.now()
  const audio = new Audio()
  audio.crossOrigin = 'anonymous'
  audio.preload = 'auto'
  audio.src = sound.url
  let stopped = false
  let nodes: AudioNode[] = []
  try {
    const ctx = audioContext()
    const gain = ctx.createGain()
    gain.gain.value = volume * (opts.level ?? 1)
    const source = ctx.createMediaElementSource(audio)
    source.connect(gain).connect(ctx.destination)
    nodes = [source, gain]
  } catch {
    // No Web Audio: the element's own volume, capped at 100%.
    audio.volume = Math.min(1, volume * (opts.level ?? 1))
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    audio.pause()
    // Let go of the element and its nodes, so stopped sounds don't pile up in the page.
    for (const node of nodes) node.disconnect()
    nodes = []
    audio.removeAttribute('src')
    audio.load()
    opts.onEnd?.()
  }
  audio.addEventListener('loadedmetadata', () => {
    if (stopped) return
    const into = offset + (performance.now() - asked) / 1000
    if (!loop && startSec + into >= endSec - 0.02) return stop()
    audio.currentTime = startSec + (loop ? into % length : into)
    void audio.play().catch(stop)
  })
  audio.addEventListener('timeupdate', () => {
    if (stopped || audio.currentTime < endSec - 0.02) return
    if (loop) audio.currentTime = startSec
    else stop()
  })
  audio.addEventListener('ended', () => {
    if (stopped) return
    if (!loop) return stop()
    audio.currentTime = startSec
    void audio.play().catch(stop)
  })
  return { stop }
}

/** One preview at a time across the page: a new one stops the one before. */
let current: null | PlayingSound = null
export function previewSound(sound: LibrarySound, onEnd?: () => void): PlayingSound {
  current?.stop()
  current = playSoundPart(sound, { onEnd })
  return current
}
export function stopPreview() {
  current?.stop()
  current = null
}

/**
 * Keeps exactly the given sounds playing: a sound new to the list starts (that far in), one that
 * left it stops at once. The preview calls it as the playhead moves, so jumping, scrubbing or
 * leaving a rank never leaves a sound running.
 */
export class CueAudio {
  private readonly live = new Map<string, PlayingSound>()

  constructor(private readonly find: (soundId: string) => LibrarySound | undefined) {}

  stopAll(): void {
    for (const sound of this.live.values()) sound.stop()
    this.live.clear()
  }

  sync(active: { key: string; offsetSec: number; soundId: string }[]): void {
    const keep = new Set(active.map((a) => a.key))
    for (const [key, sound] of this.live) {
      if (keep.has(key)) continue
      sound.stop()
      this.live.delete(key)
    }
    for (const a of active) {
      if (this.live.has(a.key)) continue
      const sound = this.find(a.soundId)
      if (sound) this.live.set(a.key, playSoundPart(sound, { offsetSec: a.offsetSec }))
    }
  }
}
