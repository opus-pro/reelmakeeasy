import {
  SFX_DESCRIPTIONS,
  SFX_NAMES,
  SFX_SAMPLE_RATE,
  type SfxName,
  synthesiseSfx,
} from '../motion-reel/sfx'

/**
 * Claude Animation's sound effects: Motion Reel's pack (whooshes, pops, ticks) plus cartoon
 * sounds for characters and pictures (a boing, a ding, a twinkle, slide whistles), all synthesised
 * in code: no samples to license, the same sounds on every machine. Short, peaking early, so a
 * sound lands on the frame it is placed on.
 */

export const CARTOON_SFX_NAMES = [
  'boing',
  'boop',
  'bubble',
  'chime',
  'coin',
  'ding',
  'shutter',
  'slide-down',
  'slide-up',
  'tada',
  'twinkle',
  'typing',
  'zip',
] as const
export type CartoonSfxName = (typeof CARTOON_SFX_NAMES)[number]

export const ANIMATION_SFX_NAMES: readonly AnimationSfxName[] = [...SFX_NAMES, ...CARTOON_SFX_NAMES]
export type AnimationSfxName = CartoonSfxName | SfxName

export const ANIMATION_SFX_DESCRIPTIONS: Record<AnimationSfxName, string> = {
  ...SFX_DESCRIPTIONS,
  boing: 'a springy cartoon boing (a bounce, a surprise, a shrug, something landing)',
  boop: 'a soft round boop (a wave, a tap, a small friendly accent)',
  bubble: 'a quick rising blip (a bubble, an icon popping up from below)',
  chime: 'a two-note chime (a new section, a notification, "here is the answer")',
  coin: 'a bright two-note coin (a number, a reward, money, a score going up)',
  ding: 'a clear little bell (a thumbs up, a right answer, a fact landing)',
  shutter: 'a camera shutter (a photo or a picture appearing)',
  'slide-down': 'a slide whistle falling (something dropping, getting smaller, a fail)',
  'slide-up': 'a slide whistle rising (something growing, flying up, a reveal)',
  tada: 'a bright four-note arpeggio (the big reveal, the end card)',
  twinkle: 'a sparkle of rising bell notes (magic, stars, something appearing with a glow)',
  typing: 'a short burst of key taps (text typing in, a headline being written)',
  zip: 'a fast zip (a pointer, an arrow, a line drawing across)',
}

export function isAnimationSfxName(name: unknown): name is AnimationSfxName {
  return typeof name === 'string' && (ANIMATION_SFX_NAMES as readonly string[]).includes(name)
}

/** The effect as samples in -1..1. Deterministic: the same effect every time. */
export function synthesiseAnimationSfx(
  name: AnimationSfxName,
  sampleRate = SFX_SAMPLE_RATE,
): Float32Array {
  if ((SFX_NAMES as readonly string[]).includes(name))
    return synthesiseSfx(name as SfxName, sampleRate)
  return faded(cartoon(name as CartoonSfxName, sampleRate), sampleRate)
}

/** A few milliseconds of fade at each end, so no sound starts or stops with a click. */
function faded(samples: Float32Array, sampleRate: number): Float32Array {
  const inLen = Math.round(0.002 * sampleRate)
  const outLen = Math.min(samples.length, Math.round(0.012 * sampleRate))
  for (let i = 0; i < inLen && i < samples.length; i++) samples[i] = (samples[i] ?? 0) * (i / inLen)
  for (let i = 0; i < outLen; i++) {
    const j = samples.length - 1 - i
    samples[j] = (samples[j] ?? 0) * (i / outLen)
  }
  return samples
}

function cartoon(name: CartoonSfxName, sampleRate: number): Float32Array {
  const random = seededRandom(hashName(name))
  switch (name) {
    case 'boing':
      return render(0.55, sampleRate, (t, s) => {
        const f = 190 * (1 + 0.55 * Math.exp(-t / 0.18) * Math.sin(2 * Math.PI * 11 * t))
        return s.sine(f) * Math.min(1, t / 0.004) * Math.exp(-t / 0.2)
      })
    case 'boop':
      return render(0.16, sampleRate, (t, s) => {
        const f = 440 + 300 * Math.exp(-t / 0.03)
        return s.sine(f) * Math.min(1, t / 0.005) * Math.exp(-t / 0.06)
      })
    case 'bubble':
      return render(0.12, sampleRate, (t, s) => {
        const f = 320 + 1300 * (t / 0.12) ** 1.6
        return s.sine(f) * Math.sin(Math.PI * Math.min(1, t / 0.12))
      })
    case 'chime':
      return notes(sampleRate, [
        { at: 0, f: 1318.5, len: 0.9 },
        { at: 0.16, f: 1046.5, len: 1 },
      ])
    case 'coin':
      return render(0.4, sampleRate, (t, s) => {
        const f = t < 0.07 ? 987.8 : 1318.5
        return s.soft(f) * 0.6 * Math.exp(-Math.max(0, t - 0.07) / 0.12)
      })
    case 'ding':
      return notes(sampleRate, [{ at: 0, f: 1568, len: 0.9 }])
    case 'shutter':
      return render(0.18, sampleRate, (t) => {
        const click = (at: number) => (t >= at ? Math.exp(-(t - at) / 0.006) : 0)
        return (random() - 0.5) * (click(0) + 0.8 * click(0.07))
      })
    case 'slide-down':
      return slide(sampleRate, 1500, 380)
    case 'slide-up':
      return slide(sampleRate, 480, 1600)
    case 'tada':
      return notes(sampleRate, [
        { at: 0, f: 523.3, len: 0.5 },
        { at: 0.09, f: 659.3, len: 0.5 },
        { at: 0.18, f: 784, len: 0.6 },
        { at: 0.27, f: 1046.5, len: 1 },
      ])
    case 'twinkle':
      return notes(sampleRate, [
        { at: 0, f: 1318.5, len: 0.5 },
        { at: 0.06, f: 1568, len: 0.5 },
        { at: 0.12, f: 1975.5, len: 0.5 },
        { at: 0.18, f: 2637, len: 0.7 },
      ])
    case 'typing': {
      const taps = Array.from({ length: 7 }, (_, i) => i * 0.07 + random() * 0.025)
      return render(0.55, sampleRate, (t) => {
        let v = 0
        for (const at of taps) if (t >= at) v += Math.exp(-(t - at) / 0.004)
        return (random() - 0.5) * v
      })
    }
    case 'zip': {
      let low = 0
      return render(0.16, sampleRate, (t) => {
        const cutoff = 800 + 9000 * (t / 0.16) ** 2
        low += (1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)) * (random() - 0.5 - low)
        return low * Math.sin(Math.PI * Math.min(1, t / 0.16))
      })
    }
  }
}

/** `soft`: a rounded square (its first odd harmonics only), retro without the buzz. */
type Oscillator = { sine: (f: number) => number; soft: (f: number) => number }

/** `duration` seconds of a sample function of time and a phase-continuous oscillator. */
function render(
  duration: number,
  sampleRate: number,
  sample: (t: number, osc: Oscillator) => number,
): Float32Array {
  const out = new Float32Array(Math.round(duration * sampleRate))
  let phase = 0
  const osc: Oscillator = {
    sine: (f) => {
      phase += (2 * Math.PI * f) / sampleRate
      return Math.sin(phase)
    },
    soft: (f) => {
      phase += (2 * Math.PI * f) / sampleRate
      return Math.sin(phase) + Math.sin(3 * phase) / 3 + Math.sin(5 * phase) / 8
    },
  }
  for (let i = 0; i < out.length; i++) out[i] = sample(i / sampleRate, osc)
  return out
}

/** Bell notes starting at their times: a soft FM bell each, its overtones harmonic (sweet, like a
 *  music box) and fading faster than the note. */
function notes(sampleRate: number, list: { at: number; f: number; len: number }[]): Float32Array {
  const duration = Math.max(...list.map((n) => n.at + n.len))
  const out = new Float32Array(Math.round(duration * sampleRate))
  for (const n of list) {
    const start = Math.round(n.at * sampleRate)
    const length = Math.round(n.len * sampleRate)
    for (let i = 0; i < length && start + i < out.length; i++) {
      const t = i / sampleRate
      const index = 0.9 * Math.exp(-t / 0.06)
      const modulator = Math.sin(2 * Math.PI * n.f * 2 * t) * index
      const v = Math.sin(2 * Math.PI * n.f * t + modulator)
      out[start + i] =
        (out[start + i] ?? 0) +
        v *
          Math.min(1, t / 0.002) *
          Math.exp(-t / (n.len / 3)) *
          // Down to silence over the note's last 10 ms: no click when it stops.
          Math.min(1, (length - i) / (0.01 * sampleRate))
    }
  }
  return out
}

/** A slide whistle from one pitch to another, with a little vibrato. */
function slide(sampleRate: number, from: number, to: number): Float32Array {
  const duration = 0.45
  return render(duration, sampleRate, (t, s) => {
    const x = t / duration
    const f = from * (to / from) ** x * (1 + 0.012 * Math.sin(2 * Math.PI * 7 * t))
    return s.sine(f) * Math.sin(Math.PI * Math.min(1, x * 1.1)) * 0.9
  })
}

function hashName(name: string): number {
  let hash = 2166136261
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return hash || 1
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}
