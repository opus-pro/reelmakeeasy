import type { BeatGrid, MusicEvents } from './beat-grid'
import {
  analyseMusicEvents,
  emptyEvents,
  eventsInWindow,
  renderMusicMap,
  steadyEvents,
  tidyEvents,
} from './music-events'
import { buildReelJson } from './reel-config'

const SR = 22050
const BPM = 120
const BEAT = 60 / BPM

/** A steady grid at 120 BPM over `seconds`. */
function steadyGrid(
  seconds: number,
): Pick<BeatGrid, 'beats' | 'bpm' | 'downbeats' | 'durationSec'> {
  const beats = Array.from({ length: Math.floor(seconds / BEAT) }, (_, i) => i * BEAT)
  return { beats, bpm: BPM, downbeats: beats.filter((_, i) => i % 4 === 0), durationSec: seconds }
}

/**
 * A synthetic track: a low sine kick on every beat, a noise snare on beats 2 and 4 of each bar,
 * and a melody of short tone bursts between the beats; quiet for the first two bars.
 */
function syntheticTrack(seconds: number) {
  const samples = new Float32Array(Math.round(seconds * SR))
  let seed = 11
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648 - 0.5
  }
  const add = (at: number, len: number, wave: (i: number) => number) => {
    const start = Math.round(at * SR)
    for (let i = 0; i < len * SR && start + i < samples.length; i++)
      samples[start + i] = (samples[start + i] ?? 0) + wave(i)
  }
  const kicks: number[] = []
  const snares: number[] = []
  const melody: number[] = []
  for (let k = 0; k * BEAT < seconds - 0.5; k++) {
    const t = k * BEAT
    const loud = t >= 4 ? 1 : 0.15
    kicks.push(t)
    add(
      t,
      0.2,
      (i) => loud * 0.8 * Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp(-i / (SR * 0.06)),
    )
    if (k % 2 === 1) {
      snares.push(t)
      add(t, 0.12, (i) => loud * 0.5 * random() * Math.exp(-i / (SR * 0.03)))
    }
    if (k % 2 === 0) {
      // A note on the and of the beat, a fifth above A5 on every other bar.
      const at = t + BEAT / 2
      const hz = k % 8 < 4 ? 880 : 1320
      melody.push(at)
      add(
        at,
        0.15,
        (i) => loud * 0.25 * Math.sin((2 * Math.PI * hz * i) / SR) * Math.min(1, i / 40),
      )
    }
  }
  return { kicks, melody, samples, snares }
}

/** Every expected time has a found one within a frame at 30 fps. */
function expectFound(expected: number[], found: number[]) {
  for (const t of expected) {
    const nearest = Math.min(...found.map((f) => Math.abs(f - t)))
    expect({ nearest: nearest <= 1 / 30, t }).toEqual({ nearest: true, t })
  }
}

describe('analyseMusicEvents', () => {
  const track = syntheticTrack(12)
  const events = analyseMusicEvents(track.samples, SR, steadyGrid(12))

  it('finds the kicks, snares and melody within a frame', () => {
    expectFound(track.kicks, events.kicks)
    expectFound(track.snares, events.snares)
    expectFound(
      track.melody,
      events.melody.map((m) => m.t),
    )
    // And little else: no kick where only a snare or a note plays.
    expect(events.kicks.length).toBeLessThanOrEqual(track.kicks.length + 2)
    expect(events.snares.some((t) => track.melody.includes(t))).toBe(false)
  })

  it('splits the quiet opening from the loud groove', () => {
    expect(events.sections[0]).toMatchObject({ name: 'intro', startSec: 0 })
    expect(events.sections[1]).toMatchObject({ energy: 3, startSec: 4 })
    expect(events.sections.at(-1)?.endSec).toBe(12)
  })

  it("doesn't take a kick's click for a snare", () => {
    const seconds = 8
    // A quiet pad under it all, so the track is never silent.
    const samples = Float32Array.from(
      { length: seconds * SR },
      (_, i) => 0.05 * Math.sin((2 * Math.PI * 440 * i) / SR),
    )
    let seed = 5
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648 - 0.5
    }
    const snares: number[] = []
    for (let k = 0; k * BEAT < seconds - 0.5; k++) {
      const start = Math.round(k * BEAT * SR)
      for (let i = 0; i < 0.2 * SR; i++) {
        // A sine kick with a short noisy click on its attack.
        const click = i < 0.004 * SR ? 0.3 * random() : 0
        samples[start + i] =
          (samples[start + i] ?? 0) +
          0.8 * Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp(-i / (SR * 0.06)) +
          click
      }
      if (k % 2 === 1) {
        // A clap on the and of beats 2 and 4, away from the kicks.
        const at = (k + 0.5) * BEAT
        snares.push(at)
        const from = Math.round(at * SR)
        for (let i = 0; i < 0.1 * SR; i++)
          samples[from + i] = (samples[from + i] ?? 0) + 0.5 * random() * Math.exp(-i / (SR * 0.03))
      }
    }
    const found = analyseMusicEvents(samples, SR, steadyGrid(seconds))
    expectFound(snares, found.snares)
    expect(found.snares.filter((t) => found.kicks.some((k) => Math.abs(k - t) < 0.03))).toEqual([])
  })

  it('splits a long loud run where its sound changes, and finds accents in each part', () => {
    // 12 bars at one level: a low pad with notes for six bars, then a bright one.
    const seconds = 24
    const samples = new Float32Array(seconds * SR)
    for (let i = 0; i < samples.length; i++) {
      const t = i / SR
      const pad = t < 12 ? Math.sin(2 * Math.PI * 110 * t) : 0.7 * Math.sin(2 * Math.PI * 3520 * t)
      const sinceBeat = t % BEAT
      const note = sinceBeat < 0.15 ? 0.3 * Math.sin(2 * Math.PI * (t < 4 ? 880 : 660) * t) : 0
      samples[i] = 0.3 * pad + (t < 4 ? 1.5 : 1) * note
    }
    const found = analyseMusicEvents(samples, SR, steadyGrid(seconds))
    expect(found.sections.map((s) => s.startSec)).toContain(12)
    const accents = found.melody.filter((m) => m.strength >= 0.8)
    expect(accents.some((m) => m.t >= 12)).toBe(true)
    expect(accents.some((m) => m.t >= 4 && m.t < 12)).toBe(true)
  })

  it('handles silence', () => {
    const silent = analyseMusicEvents(new Float32Array(SR * 4), SR, steadyGrid(4))
    expect(silent.kicks).toEqual([])
    expect(silent.melody).toEqual([])
    expect(silent.sections.length).toBe(1)
  })
})

describe('tidyEvents', () => {
  it('keeps at most two kicks a beat and eight notes a second, sorted and rounded', () => {
    const tidy = tidyEvents(
      {
        chords: [1.00004, 0],
        kicks: [0, 0.125, 0.25, 0.375].map((t, i) => ({ s: i, t })),
        melody: Array.from({ length: 20 }, (_, i) => ({ strength: i / 20, t: i * 0.05 })),
        sections: [{ endSec: 1, energy: 2, name: 'groove', startSec: 0 }],
        snares: [],
      },
      [0, 0.5],
      1,
    )
    expect(tidy.kicks).toEqual([0.25, 0.375])
    expect(tidy.melody.length).toBe(8)
    expect(tidy.melody[0]?.t).toBe(0.6)
    expect(tidy.chords).toEqual([0, 1])
  })
})

const EVENTS: MusicEvents = {
  chords: [0, 2, 4, 6],
  kicks: [0, 0.5, 1, 2, 2.5, 4, 6.04],
  melody: [
    { strength: 1, t: 2 },
    { strength: 0.6, t: 2.25 },
    { strength: 0.8, t: 3.5 },
  ],
  sections: [
    { endSec: 2, energy: 1, name: 'intro', startSec: 0 },
    { endSec: 6, energy: 3, name: 'drop', startSec: 2 },
    { endSec: 8, energy: 0, name: 'outro', startSec: 6 },
  ],
  snares: [0.5, 2.5],
}

describe('eventsInWindow', () => {
  it('shifts the events to the window and clips the sections', () => {
    const inside = eventsInWindow(EVENTS, 2, 4)
    expect(inside.kicks).toEqual([0, 0.5, 2])
    expect(inside.snares).toEqual([0.5])
    expect(inside.melody).toEqual([
      { strength: 1, t: 0 },
      { strength: 0.6, t: 0.25 },
      { strength: 0.8, t: 1.5 },
    ])
    expect(inside.chords).toEqual([0, 2])
    expect(inside.sections).toEqual([{ endSec: 4, energy: 3, name: 'drop', startSec: 0 }])
  })

  it('is one groove section with no events when the grid has none', () => {
    expect(eventsInWindow(undefined, 3, 8)).toEqual(emptyEvents(8))
    expect(emptyEvents(8).sections).toEqual([{ endSec: 8, energy: 2, name: 'groove', startSec: 0 }])
  })
})

describe('the music map', () => {
  it('lists each bar in reel beat numbers, with section starts marked', () => {
    const reel = {
      bars: 4,
      beats: Array.from({ length: 16 }, (_, i) => i * 0.5),
      beatsPerBar: 4,
      bpm: 120,
      downbeats: [0, 2, 4, 6],
      events: EVENTS,
      lengthSec: 8,
      music: 'music.wav',
    }
    expect(renderMusicMap(reel, 'A minor')).toMatchInlineSnapshot(`
      "# Music map

      120 BPM, 4 bars of 4 beats, 8 s, key A minor.
      Beats are reel beat numbers (what \`beat(n)\` takes; fractions are parts of a beat). Accents: melody notes of strength 0.8 and up.
      Sections: intro beats 0-4 (energy 1), drop beats 4-12 (energy 3), outro beats 12-16 (energy 0).

      == intro starts ==
      bar 1 (beats 0-3) intro, energy 1 | kicks 0 1 2 | snares 1 | chord change
      == drop starts ==
      bar 2 (beats 4-7) drop, energy 3 | kicks 4 5 | snares 5 | melody 4 4.5 7 (accents 4 7) | chord change
      bar 3 (beats 8-11) drop, energy 3 | kicks 8 | chord change
      == outro starts ==
      bar 4 (beats 12-15) outro, energy 0 | kicks 12.08 | chord change
      "
    `)
  })

  it('gives a reel without music a steady grid of events', () => {
    const reel = buildReelJson({
      fit: null,
      grid: null,
      lengthSec: 4,
      musicFile: null,
      ratio: '16:9',
      subject: 'x',
    })
    expect(reel.events).toEqual(steadyEvents(reel.beats, reel.downbeats, reel.lengthSec))
    expect(reel.events.kicks).toEqual(reel.beats)
    expect(reel.events.chords).toEqual(reel.downbeats)
    expect(renderMusicMap(reel)).toMatch(/\(no music: a steady grid\)/)
  })
})
