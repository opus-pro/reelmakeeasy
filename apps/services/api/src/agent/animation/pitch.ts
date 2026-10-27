/** The pitch range a speaking voice can have, in Hz. */
const MIN_HZ = 70
const MAX_HZ = 400
/** Analysis frame length, in seconds. */
const FRAME_SEC = 0.04
/** A frame quieter than this (RMS, 0..1) is not voiced. */
const SILENT_RMS = 0.02
/** A frame whose best correlation is under this is not voiced. */
const VOICED_CORRELATION = 0.5

/** A 16-bit PCM WAV's mono samples (first channel), -1..1, and its sample rate. */
export function wavSamples(wav: Buffer): { rate: number; samples: Float32Array } {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Not a WAV file')
  let offset = 12
  let rate = 0
  let channels = 1
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      channels = wav.readUInt16LE(body + 2)
      rate = wav.readUInt32LE(body + 4)
    } else if (id === 'data') {
      const end = Math.min(wav.length, body + size)
      const count = Math.floor((end - body) / (2 * channels))
      const samples = new Float32Array(count)
      for (let i = 0; i < count; i++) samples[i] = wav.readInt16LE(body + i * 2 * channels) / 32768
      return { rate, samples }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV has no data')
}

/**
 * A voice's typical pitch: the median of its voiced frames' pitch (autocorrelation over 40 ms
 * frames, 70-400 Hz), or null when nothing is voiced. Used to keep a character's takes alike.
 */
export function medianPitchHz(wav: Buffer): null | number {
  const { rate, samples } = wavSamples(wav)
  const size = Math.round(FRAME_SEC * rate)
  const minLag = Math.floor(rate / MAX_HZ)
  const maxLag = Math.ceil(rate / MIN_HZ)
  const pitches: number[] = []
  for (let start = 0; start + size + maxLag <= samples.length; start += size) {
    let energy = 0
    for (let i = start; i < start + size; i++) energy += (samples[i] as number) ** 2
    if (Math.sqrt(energy / size) < SILENT_RMS) continue
    let bestLag = 0
    let best = 0
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0
      let a = 0
      let b = 0
      for (let i = start; i < start + size; i++) {
        const x = samples[i] as number
        const y = samples[i + lag] as number
        sum += x * y
        a += x * x
        b += y * y
      }
      const r = sum / Math.sqrt(a * b || 1)
      if (r > best) {
        best = r
        bestLag = lag
      }
    }
    if (best >= VOICED_CORRELATION && bestLag) pitches.push(rate / bestLag)
  }
  if (!pitches.length) return null
  pitches.sort((x, y) => x - y)
  return pitches[Math.floor(pitches.length / 2)] as number
}
