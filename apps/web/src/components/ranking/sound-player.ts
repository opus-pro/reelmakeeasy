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
 * Plays a library sound the way the export will: only its trimmed part, at its level (a level
 * above 100% goes through a Web Audio gain, which an <audio> element's volume can't do), times
 * `level` (the short's music level). `loop` repeats the part until stopped.
 */
export function playSoundPart(
  sound: LibrarySound,
  opts: { level?: number; loop?: boolean; onEnd?: () => void } = {},
): PlayingSound {
  const { endSec, startSec, volume } = soundPlayback(sound)
  const audio = new Audio()
  audio.crossOrigin = 'anonymous'
  audio.preload = 'auto'
  audio.src = sound.url
  let stopped = false
  try {
    const ctx = audioContext()
    const gain = ctx.createGain()
    gain.gain.value = volume * (opts.level ?? 1)
    ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination)
  } catch {
    // No Web Audio: the element's own volume, capped at 100%.
    audio.volume = Math.min(1, volume * (opts.level ?? 1))
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    audio.pause()
    audio.removeAttribute('src')
    opts.onEnd?.()
  }
  audio.addEventListener('loadedmetadata', () => {
    audio.currentTime = startSec
    void audio.play().catch(stop)
  })
  audio.addEventListener('timeupdate', () => {
    if (audio.currentTime < endSec - 0.02) return
    if (opts.loop) audio.currentTime = startSec
    else stop()
  })
  audio.addEventListener('ended', () => {
    if (!opts.loop) return stop()
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
