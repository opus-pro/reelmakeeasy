import { type SfxName, type SoundCue, Sounds } from '../kit'

import type { Cue, Gesture, Mood } from './pose'

/** The sound each gesture makes as it lands (null: none). */
export type GestureSounds = Partial<Record<Gesture | Mood, null | SfxName>>

/** Cute and light: a gesture gets a small sound, never louder than the voice. */
export const DEFAULT_GESTURE_SOUNDS: GestureSounds = {
  count: 'bubble',
  open: 'swish',
  point: 'zip',
  shrug: 'boing',
  surprised: 'boing',
  think: 'bubble',
  thumb: 'ding',
  wave: 'boop',
}

const VOLUME = 0.35

/** The sound cues of the gesture and mood cues: a count gets one per finger, a wave two boops. */
export function gestureSoundCues(
  cues: Cue[],
  sounds: GestureSounds = DEFAULT_GESTURE_SOUNDS,
): SoundCue[] {
  const out: SoundCue[] = []
  for (const c of cues) {
    const key = c.gesture ?? c.mood
    const name = key ? sounds[key] : null
    if (!name) continue
    if (c.gesture === 'count')
      for (let i = 0; i < Math.max(1, Math.min(5, c.n ?? 1)); i++)
        out.push({ at: c.at + i * 0.14, name, volume: VOLUME })
    else if (c.gesture === 'wave')
      out.push({ at: c.at, name, volume: VOLUME }, { at: c.at + 0.28, name, volume: VOLUME * 0.8 })
    else out.push({ at: c.at, name, volume: VOLUME })
  }
  return out
}

/** The host's gesture sounds (on by default in the TalkingHead stages). */
export function GestureSoundTrack({ cues, sounds }: { cues: Cue[]; sounds?: GestureSounds }) {
  return <Sounds cues={gestureSoundCues(cues, sounds)} />
}
