import {
  encodeWav,
  RISER_LEAD_SEC,
  SFX_DESCRIPTIONS,
  SFX_NAMES,
  SFX_SAMPLE_RATE,
  synthesiseSfx,
} from './sfx'

const peakIndex = (samples: Float32Array) => {
  let index = 0
  for (let i = 0; i < samples.length; i++)
    if (Math.abs(samples[i] ?? 0) > Math.abs(samples[index] ?? 0)) index = i
  return index
}

describe('synthesiseSfx', () => {
  it.each(SFX_NAMES)('%s is short, finite, audible and described', (name) => {
    const samples = synthesiseSfx(name)
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.length / SFX_SAMPLE_RATE).toBeLessThan(2.5)
    expect(samples.every(Number.isFinite)).toBe(true)
    expect(Math.abs(samples[peakIndex(samples)] ?? 0)).toBeGreaterThan(0.05)
    expect(SFX_DESCRIPTIONS[name].length).toBeGreaterThan(10)
  })

  it('is the same every time', () => {
    expect(synthesiseSfx('glitch')).toEqual(synthesiseSfx('glitch'))
  })

  it('peaks early on hits, so they land on the frame they are placed on', () => {
    for (const name of ['tick', 'click', 'pop', 'hit'] as const) {
      expect(peakIndex(synthesiseSfx(name)) / SFX_SAMPLE_RATE).toBeLessThan(0.03)
    }
  })

  it('builds a riser to its peak at RISER_LEAD_SEC', () => {
    const peak = peakIndex(synthesiseSfx('riser')) / SFX_SAMPLE_RATE
    expect(Math.abs(peak - RISER_LEAD_SEC)).toBeLessThan(0.1)
  })
})

describe('encodeWav', () => {
  it('writes a valid 16-bit mono PCM header and normalises the peak', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.25]))
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(SFX_SAMPLE_RATE)
    expect(wav.readUInt32LE(40)).toBe(6)
    expect(wav.readInt16LE(46)).toBe(Math.round(0.891 * 32767))
  })
})
