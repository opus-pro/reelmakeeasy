/**
 * Motion Reel's sound-effect pack, synthesised in code: no samples to license, the same sounds on
 * every machine. Each effect is written as a 16-bit mono WAV at 44.1 kHz. A reel places them on its
 * beat grid (one on each cut or impact), so they are short and peak early: the hit lands on the
 * frame it is placed on. `riser` is the exception: it builds for its length and ends on its frame.
 */

export const SFX_SAMPLE_RATE = 44100

export const SFX_NAMES = [
  'whoosh',
  'swish',
  'riser',
  'tick',
  'click',
  'pop',
  'hit',
  'sub-drop',
  'glitch',
  'shimmer',
] as const
export type SfxName = (typeof SFX_NAMES)[number]

/** What each effect is for, as the skill and the brief describe it to the agent. */
export const SFX_DESCRIPTIONS: Record<SfxName, string> = {
  click: 'a dry UI click (buttons, toggles, a cursor press)',
  glitch: 'a short digital stutter (glitch cuts, data, tech reveals)',
  hit: 'a punchy low impact with a crack (big title slams, the drop)',
  pop: 'a bubbly pitch-drop pop (shapes, icons or cards appearing)',
  riser:
    'a 2-second build that ends on its frame (place it to end on the drop; the file starts 2 s earlier)',
  shimmer: 'a bright sparkle tail (logo reveals, end cards)',
  'sub-drop': 'a deep falling boom (scene drops, dark reveals)',
  swish: 'a fast light swish (small moves, text sliding in)',
  tick: 'a crisp tick (counters, timecode, every cut in precise styles)',
  whoosh: 'an air whoosh (transitions, big moves across the frame)',
}

/** Seconds of build before a riser's peak: place a riser `RISER_LEAD_SEC` before the hit it leads into. */
export const RISER_LEAD_SEC = 2

/** The effect as samples in -1..1. Deterministic: the same effect every time. */
export function synthesiseSfx(name: SfxName, sampleRate = SFX_SAMPLE_RATE): Float32Array {
  const random = seededRandom(hashName(name))
  switch (name) {
    case 'click': {
      return tone(
        0.03,
        sampleRate,
        (t) => Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t / 0.004),
        random,
        0.6,
      )
    }
    case 'glitch': {
      return glitch(0.3, sampleRate, random)
    }
    case 'hit': {
      return hit(0.75, sampleRate, random)
    }
    case 'pop': {
      return chirp(0.09, sampleRate, 900, 220, 0.025)
    }
    case 'riser': {
      return riser(RISER_LEAD_SEC + 0.15, sampleRate, random)
    }
    case 'shimmer': {
      return shimmer(1.2, sampleRate, random)
    }
    case 'sub-drop': {
      return chirp(1.1, sampleRate, 95, 32, 0.45)
    }
    case 'swish': {
      return sweepNoise(0.28, sampleRate, random, { from: 1200, peakAt: 0.4, to: 9000 })
    }
    case 'tick': {
      return tone(
        0.05,
        sampleRate,
        (t) => Math.sin(2 * Math.PI * 4200 * t) * Math.exp(-t / 0.006),
        random,
        0.25,
      )
    }
    case 'whoosh': {
      return sweepNoise(0.7, sampleRate, random, { from: 300, peakAt: 0.55, to: 5000 })
    }
  }
}

/** A 16-bit PCM mono WAV file for the samples (peak-normalised to -1 dBFS). */
export function encodeWav(samples: Float32Array, sampleRate = SFX_SAMPLE_RATE): Buffer {
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  const gain = peak > 0 ? 0.891 / peak : 0
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, (samples[i] ?? 0) * gain))
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function seconds(duration: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.round(duration * sampleRate))
}

/** Noise through a lowpass whose cutoff rises then falls, swelling in and out: air moving past. */
function sweepNoise(
  duration: number,
  sampleRate: number,
  random: () => number,
  o: { from: number; peakAt: number; to: number },
): Float32Array {
  const out = seconds(duration, sampleRate)
  let low = 0
  let band = 0
  for (let i = 0; i < out.length; i++) {
    const x = i / out.length
    const rise = x < o.peakAt ? x / o.peakAt : 1 - (x - o.peakAt) / (1 - o.peakAt)
    const cutoff = o.from + (o.to - o.from) * rise ** 1.5
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)
    low += a * (random() - low)
    band += a * (low - band)
    const envelope =
      Math.sin(Math.PI * Math.min(1, x / o.peakAt) * 0.5) *
      (1 - Math.max(0, x - o.peakAt) / (1 - o.peakAt)) ** 1.6
    out[i] = (low - band * 0.6) * envelope
  }
  return out
}

/** A build: noise opening up and a tone sweeping upward, loudest at the end, then a short tail. */
function riser(duration: number, sampleRate: number, random: () => number): Float32Array {
  const out = seconds(duration, sampleRate)
  const buildSamples = Math.round(RISER_LEAD_SEC * sampleRate)
  let low = 0
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const inBuild = i < buildSamples
    const x = inBuild ? i / buildSamples : 1
    const tail = inBuild ? 1 : Math.exp(-(i - buildSamples) / (0.03 * sampleRate))
    const cutoff = 200 + 7000 * x ** 2.2
    low += (1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)) * (random() - low)
    phase += (2 * Math.PI * (180 + 1400 * x ** 2)) / sampleRate
    out[i] = (low * 0.8 + Math.sin(phase) * 0.35) * x ** 2.4 * tail
  }
  return out
}

/** A short tone with a little noise in its attack. */
function tone(
  duration: number,
  sampleRate: number,
  wave: (t: number) => number,
  random: () => number,
  noiseAmount: number,
): Float32Array {
  const out = seconds(duration, sampleRate)
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate
    out[i] = wave(t) + noiseAmount * (random() - 0.5) * Math.exp(-t / 0.002)
  }
  return out
}

/** A sine whose pitch falls exponentially from `from` to `to` Hz, decaying over `decay` seconds. */
function chirp(
  duration: number,
  sampleRate: number,
  from: number,
  to: number,
  decay: number,
): Float32Array {
  const out = seconds(duration, sampleRate)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate
    const frequency = to + (from - to) * Math.exp(-t / (duration / 4))
    phase += (2 * Math.PI * frequency) / sampleRate
    const attack = Math.min(1, t / 0.002)
    out[i] = Math.sin(phase) * attack * Math.exp(-t / decay)
  }
  return out
}

/** A kick-like body, a noise crack on top, and a short low tail. */
function hit(duration: number, sampleRate: number, random: () => number): Float32Array {
  const body = chirp(duration, sampleRate, 140, 42, 0.22)
  const out = seconds(duration, sampleRate)
  let high = 0
  let previous = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate
    const noise = random() - 0.5
    high = 0.85 * (high + noise - previous)
    previous = noise
    out[i] = (body[i] ?? 0) + 0.7 * high * Math.exp(-t / 0.035)
  }
  return out
}

/** Chopped, pitch-stepped bits of noise and tone: a digital stutter. */
function glitch(duration: number, sampleRate: number, random: () => number): Float32Array {
  const out = seconds(duration, sampleRate)
  const slice = Math.round(0.025 * sampleRate)
  for (let start = 0; start < out.length; start += slice) {
    const on = random() > 0.3
    const frequency = 300 + Math.floor(random() * 8) * 220
    const crush = 1 + Math.floor(random() * 6)
    let held = 0
    for (let i = 0; i < slice && start + i < out.length; i++) {
      if (i % crush === 0)
        held =
          0.6 * Math.sign(Math.sin((2 * Math.PI * frequency * i) / sampleRate)) +
          0.4 * (random() - 0.5)
      const fade = 1 - (start + i) / out.length
      out[start + i] = on ? held * fade : 0
    }
  }
  return out
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

/** A cluster of high partials with slow random flutter, fading out. */
function shimmer(duration: number, sampleRate: number, random: () => number): Float32Array {
  const out = seconds(duration, sampleRate)
  const partials = [2637, 3136, 3951, 5274].map((f) => ({
    f,
    phase: random() * Math.PI * 2,
    rate: 3 + random() * 5,
  }))
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate
    let sum = 0
    for (const p of partials)
      sum +=
        Math.sin(2 * Math.PI * p.f * t + p.phase) * (0.6 + 0.4 * Math.sin(2 * Math.PI * p.rate * t))
    out[i] = (sum / partials.length) * Math.min(1, t / 0.01) * Math.exp(-t / 0.35)
  }
  return out
}
