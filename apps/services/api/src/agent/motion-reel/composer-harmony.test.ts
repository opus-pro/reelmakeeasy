/**
 * The composer's harmony check (`tools/motion-composer/audio/harmony.mjs`). The composer is plain
 * Node ESM that ReelMakeEasy never imports, so these tests run it in a child `node`, as the agent's
 * shell does: the checker on hand-built note lists, then `score.mjs --harmony` on two real scores.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { composerSourceDir } from './motion-composer'

const AUDIO = path.join(composerSourceDir(), 'audio')
const FIXTURES = path.join(__dirname, 'fixtures', 'harmony')

type Counts = Record<string, number>
type Harmony = {
  borrowed: { chord: string }[]
  clashes: { byInterval: Record<string, number>; count: number; worst: { interval: string }[] }
  counts: Counts
  issues: Record<string, { msg: string }[]>
  key: null | string
  mode: null | string
  status: 'FAIL' | 'PASS'
  summary: string
}

/** A hand-built piece: sections by key and mode name, chords as symbols, notes as MIDI. */
type Piece = {
  bpm?: number
  chords: { t0: number; t1: number; tok: number[] | string }[]
  notes: {
    dur: number
    hz?: true
    inst?: string
    midi: number
    params?: Record<string, unknown>
    role?: 'bass' | 'chord' | 'melody'
    t: number
    voice: string
  }[]
  sections: { at: number; end: number; key: null | string; mode: null | string; name: string }[]
}

/** Runs checkHarmony on each piece in a child node (the checker is the composer's own ESM). */
function check(...pieces: Piece[]): Harmony[] {
  const url = (file: string) => pathToFileURL(path.join(AUDIO, file)).href
  const code = `
    import { checkHarmony, soundingSec, inharmonicWhy } from '${url('harmony.mjs')}';
    import { parseChord, pcOf, resolveScale } from '${url('theory.mjs')}';
    let raw = ''; process.stdin.on('data', d => (raw += d)).on('end', () => {
      const out = JSON.parse(raw).map(p => {
        const beatSec = 60 / (p.bpm ?? 120);
        const sections = p.sections.map(s => ({ ...s, keyPc: s.key ? pcOf(s.key) : null, scale: s.mode ? resolveScale(s.mode) : null }));
        const secAt = t => sections.filter(s => t >= s.at - 1e-6).pop();
        const chords = p.chords.map(c => { const s = secAt(c.t0); return { t0: c.t0, t1: c.t1, chord: parseChord(c.tok, s.keyPc ?? 0, s.scale ?? resolveScale('ionian')) }; });
        const notes = p.notes.map(n => { const inst = n.inst ?? 'epiano', params = n.params ?? {};
          return { vel: 0.8, role: 'melody', ...n, inst, hold: soundingSec(inst, params, n.dur), inharmonic: inharmonicWhy(inst, params) }; });
        return checkHarmony({ beatsPerBar: 4, stepsPerBar: 16, beatSec, start: 0, duration: 1e9, sections, chords, notes });
      });
      process.stdout.write(JSON.stringify(out));
    });`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    input: JSON.stringify(pieces),
  })
  if (run.status !== 0) throw new Error(run.stderr)
  return JSON.parse(run.stdout) as Harmony[]
}

const C_MAJOR = [{ at: 0, end: 8, key: 'C', mode: 'ionian', name: 'a' }]
/** A C major pad held for two bars at 120 BPM (a beat is 0.5 s, a 16th 0.125 s). */
const PAD = [60, 64, 67].map((midi) => ({
  dur: 4,
  inst: 'pad',
  midi,
  role: 'chord' as const,
  t: 0,
  voice: 'pad',
}))
const ROOT = { dur: 4, inst: 'sub', midi: 36, role: 'bass' as const, t: 0, voice: 'bass' }

describe('the harmony check on hand-built notes', () => {
  it('passes a stable piece: chord tones on every step, a 9th, no passing tones', () => {
    const [h] = check({
      chords: [{ t0: 0, t1: 4, tok: 'C' }],
      notes: [
        ...PAD,
        ROOT,
        { dur: 0.45, midi: 72, t: 0, voice: 'lead' }, // C on beat 1
        { dur: 0.1, midi: 79, t: 0.625, voice: 'lead' }, // G on a weak 16th: a chord tone
        { dur: 0.45, midi: 74, t: 0.75, voice: 'lead' }, // D, the 9th, off the beat
        { dur: 0.9, midi: 76, t: 1, voice: 'lead' }, // E on beat 3, held
        { dur: 0.9, midi: 74, t: 2, inst: 'bell', params: { ratio: 2 }, voice: 'bell' }, // integer-ratio bell, the 9th
      ],
      sections: C_MAJOR,
    })
    expect(h?.status).toBe('PASS')
    expect(h?.summary).toMatch(
      /^C ionian: \d+ pitched notes, every chord stable and in the key, no sustained clash/,
    )
  })

  it('fails a passing tone, even a short step on a weak 16th (no passing or neighbour tones at all)', () => {
    const [diatonic, chromatic] = check(
      {
        chords: [{ t0: 0, t1: 4, tok: 'C' }],
        notes: [
          ...PAD,
          ROOT,
          { dur: 0.2, midi: 76, t: 0.5, voice: 'lead' }, // E on beat 2
          { dur: 0.1, midi: 77, t: 0.875, voice: 'lead' }, // F on a weak 16th, a step from both: once a passing tone
          { dur: 0.4, midi: 79, t: 1, voice: 'lead' }, // G on beat 3
        ],
        sections: C_MAJOR,
      },
      {
        chords: [{ t0: 0, t1: 4, tok: 'C' }],
        notes: [
          ...PAD,
          ROOT,
          { dur: 0.45, midi: 72, t: 0, voice: 'lead' }, // C on beat 1
          { dur: 0.1, midi: 73, t: 0.625, voice: 'lead' }, // C# on a weak 16th: once a chromatic passing tone
          { dur: 0.45, midi: 74, t: 0.75, voice: 'lead' }, // D, the 9th
        ],
        sections: C_MAJOR,
      },
    )
    expect(diatonic?.status).toBe('FAIL')
    expect(diatonic?.counts['nonchord']).toBe(1)
    expect(diatonic?.issues['nonchord']?.[0]?.msg).toMatch(
      /^0.875 s lead F5 over C: .*neither a chord tone \(C E G\) nor its plain 9th\/11th/,
    )
    expect(chromatic?.status).toBe('FAIL')
    expect(chromatic?.counts['keyNotes']).toBe(1)
    expect(chromatic?.issues['keyNotes']?.[0]?.msg).toMatch(
      /0.625 s lead C#5 over C: C# is outside C ionian/,
    )
  })

  it('finds a sustained clash and the non-chord tone that makes it', () => {
    const [h] = check({
      chords: [{ t0: 0, t1: 4, tok: 'C' }],
      notes: [...PAD, ROOT, { dur: 1, midi: 65, t: 0, voice: 'lead' }], // F4 held against the pad's E4
      sections: C_MAJOR,
    })
    expect(h?.status).toBe('FAIL')
    expect(h?.counts['nonchord']).toBe(1)
    expect(h?.clashes.count).toBe(1)
    expect(h?.clashes.worst[0]).toMatchObject({
      interval: 'minor 2nd',
      notes: ['E4', 'F4'],
      voices: ['pad', 'lead'],
    })
  })

  it("leaves a stable chord's own colour alone: a maj7's 7th, a m9's 9th, a V7's tritone", () => {
    const [h] = check({
      chords: [
        { t0: 0, t1: 2, tok: 'Cmaj7' },
        { t0: 2, t1: 4, tok: 'Am9' },
        { t0: 4, t1: 6, tok: 'G7' },
      ],
      notes: [
        { dur: 1.9, midi: 48, role: 'bass', t: 0, voice: 'bass' },
        { dur: 1.9, midi: 71, t: 0, voice: 'lead' }, // B over the C bass: a major 7th, the chord's own
        { dur: 1.9, midi: 57, role: 'bass', t: 2, voice: 'bass' },
        { dur: 1.9, midi: 72, role: 'chord', t: 2, voice: 'pad' },
        { dur: 1.9, midi: 71, t: 2, voice: 'lead' }, // B (the 9th) a major 7th under the pad's C
        { dur: 1.9, midi: 43, role: 'bass', t: 4, voice: 'bass' },
        { dur: 1.9, midi: 65, role: 'chord', t: 4, voice: 'pad' },
        { dur: 1.9, midi: 71, t: 4, voice: 'lead' }, // B against F: the V7's tritone
      ],
      sections: C_MAJOR,
    })
    expect(h?.status).toBe('PASS')
  })

  it('flags a slash chord whose bass is not a chord tone, and #11 and diminished chords', () => {
    const [h] = check({
      chords: [
        { t0: 0, t1: 2, tok: 'F/Eb' },
        { t0: 2, t1: 4, tok: 'Ebmaj7#11' },
        { t0: 4, t1: 6, tok: 'Bb/Eb' }, // a pedal under a chord that does not hold it either
        { t0: 6, t1: 8, tok: 'Ddim' },
      ],
      notes: [{ dur: 0.4, midi: 63, role: 'bass', t: 0, voice: 'bass' }],
      sections: [{ at: 0, end: 8, key: 'Eb', mode: 'ionian', name: 'a' }],
    })
    expect(h?.status).toBe('FAIL')
    expect(h?.counts['slash']).toBe(2)
    expect(h?.issues['slash']?.[0]?.msg).toMatch(
      /F\/Eb: the bass Eb is not a tone of the chord \(F A C\)/,
    )
    expect(h?.counts['chords']).toBe(2)
    expect(h?.issues['chords']?.map((i) => i.msg)).toEqual(['Ebmaj7#11: #11', 'Ddim: diminished'])
  })

  it('accepts a pedal on the tonic under chords that contain it', () => {
    const [h] = check({
      chords: [
        { t0: 0, t1: 2, tok: 'Ab/Eb' },
        { t0: 2, t1: 4, tok: 'Eb' },
      ],
      notes: [{ dur: 3.9, midi: 39, role: 'bass', t: 0, voice: 'bass' }],
      sections: [{ at: 0, end: 4, key: 'Eb', mode: 'ionian', name: 'a' }],
    })
    expect(h?.status).toBe('PASS')
  })

  it('refuses lydian and the other unstable modes, and a mode switch mid-piece', () => {
    const notes = [{ dur: 0.4, midi: 63, t: 0, voice: 'lead' }]
    const [lydian, phrygian, pentatonic, aeolian] = [
      'lydian',
      'phrygian',
      'minorPentatonic',
      'aeolian',
    ].map(
      (mode) =>
        check({ chords: [], notes, sections: [{ at: 0, end: 4, key: 'Eb', mode, name: 'a' }] })[0],
    )
    expect(lydian?.status).toBe('FAIL')
    expect(lydian?.issues['mode']?.[0]?.msg).toMatch(/Eb lydian is not an allowed mode/)
    expect(phrygian?.counts['mode']).toBe(1)
    expect(pentatonic?.counts['mode']).toBe(1)
    expect(aeolian?.status).toBe('PASS')

    const [switched, relative] = check(
      {
        chords: [],
        notes,
        sections: [
          { at: 0, end: 2, key: 'Eb', mode: 'aeolian', name: 'open' },
          { at: 2, end: 8, key: 'Eb', mode: 'ionian', name: 'drop' },
        ],
      },
      {
        chords: [],
        notes,
        sections: [
          { at: 0, end: 4, key: 'C', mode: 'aeolian', name: 'verse' },
          { at: 4, end: 8, key: 'Eb', mode: 'ionian', name: 'chorus' },
        ],
      },
    )
    expect(switched?.counts['key']).toBe(1)
    expect(switched?.issues['key']?.[0]?.msg).toMatch(
      /section "open" is Eb aeolian, the piece Eb ionian/,
    )
    expect(relative?.status).toBe('PASS') // C minor -> Eb major: the relative major
  })

  it('lets the bell hold a pitch whatever its ratio (the owner approved the 1.4 bell)', () => {
    const [h] = check({
      chords: [{ t0: 0, t1: 4, tok: 'C' }],
      notes: [
        ...PAD,
        { dur: 1, inst: 'bell', midi: 79, params: { decay: 0.9, ratio: 1.4 }, t: 0, voice: 'bell' }, // G, held
        { dur: 1, inst: 'bell', midi: 76, t: 2, voice: 'bell' }, // E on the default ratio
      ],
      sections: C_MAJOR,
    })
    expect(h?.status).toBe('PASS')
    expect(h?.counts['inharmonic']).toBe(0)
  })

  it('refuses an inharmonic voice holding a pitch, and lets it tick', () => {
    const glass = { inst: 'fm', params: { decay: 0.9, ratio: 2.32 }, voice: 'glass' }
    const [h] = check({
      chords: [{ t0: 0, t1: 4, tok: 'C' }],
      notes: [
        ...PAD,
        { ...glass, dur: 1, midi: 79, t: 0 },
        { ...glass, dur: 0.03, midi: 84, params: { decay: 0.05, ratio: 2.32 }, t: 1 },
        { dur: 1, inst: 'glass', midi: 76, t: 2, voice: 'plate' },
      ],
      sections: C_MAJOR,
    })
    expect(h?.counts['inharmonic']).toBe(2)
    expect(h?.issues['inharmonic']?.[0]?.msg).toMatch(
      /fm ratio 2.32 \(not an integer\) holds a pitch/,
    )
  })

  it('counts a note outside the key, and refuses a chord borrowed from the parallel minor', () => {
    const [h] = check({
      chords: [
        { t0: 0, t1: 2, tok: 'i' },
        { t0: 2, t1: 4, tok: 'bVImaj7' }, // F#m -> Dmaj7: borrowed from F# minor, a mode switch
      ],
      notes: [
        { dur: 0.9, midi: 69, t: 0, voice: 'lead' }, // A over F#m
        { dur: 0.9, midi: 65, t: 1, voice: 'lead' }, // F natural on a beat, held: outside the key
        { dur: 0.9, midi: 74, t: 2, voice: 'lead' }, // D over the borrowed Dmaj7: outside F# dorian too
      ],
      sections: [{ at: 0, end: 4, key: 'F#', mode: 'dorian', name: 'a' }],
    })
    expect(h?.status).toBe('FAIL')
    expect(h?.counts['keyNotes']).toBe(2)
    expect(h?.issues['keyNotes']?.[0]?.msg).toMatch(/F is outside F# dorian/)
    expect(h?.counts['outside']).toBe(1)
    expect(h?.issues['outside']?.[0]?.msg).toMatch(
      /borrowed from the parallel minor: a mode switch/,
    )
    expect(h?.borrowed.map((b) => b.chord)).toEqual(['bVImaj7'])
  })

  it('refuses a whole section on the parallel minor under one key name', () => {
    const [h] = check({
      chords: ['C', 'G', 'Am', 'F', 'Cm', 'Ab', 'Eb', 'Bb'].map((tok, i) => ({
        t0: i * 2,
        t1: i * 2 + 2,
        tok,
      })),
      notes: [
        { dur: 1.9, midi: 63, t: 8, voice: 'lead' }, // Eb, a chord tone of Cm
        { dur: 1.9, midi: 68, t: 10, voice: 'lead' }, // Ab over Ab
      ],
      sections: [{ at: 0, end: 16, key: 'C', mode: 'ionian', name: 'a' }],
    })
    expect(h?.status).toBe('FAIL')
    expect(h?.counts['outside']).toBe(4)
    expect(h?.counts['keyNotes']).toBe(2)
  })

  it("allows a minor key's major V7 and its leading tone, and a 7th or 9th chord on any degree whose tones are in the key", () => {
    const [minorV, notV, outside] = check(
      {
        chords: [
          { t0: 0, t1: 2, tok: 'Am' },
          { t0: 2, t1: 4, tok: 'E7' },
        ],
        notes: [{ dur: 0.9, midi: 68, t: 2, voice: 'lead' }], // G#, the leading tone, over E7
        sections: [{ at: 0, end: 4, key: 'A', mode: 'aeolian', name: 'a' }],
      },
      {
        chords: [{ t0: 0, t1: 2, tok: 'B9' }], // IV9 in F# dorian: B D# F# A C#, all in the key
        notes: [
          { dur: 1.9, inst: 'sub', midi: 35, role: 'bass', t: 0, voice: 'bass' },
          ...[57, 61, 63, 66].map((midi) => ({
            dur: 1.9,
            inst: 'pad',
            midi,
            role: 'chord' as const,
            t: 0,
            voice: 'pad',
          })),
          { dur: 0.9, midi: 73, t: 0, voice: 'lead' }, // C#, the chord's own 9th
        ],
        sections: [{ at: 0, end: 2, key: 'F#', mode: 'dorian', name: 'a' }],
      },
      {
        chords: [{ t0: 0, t1: 2, tok: 'D7' }], // II7 in C major: its F# is outside the key (a secondary dominant)
        notes: [{ dur: 1.9, inst: 'sub', midi: 38, role: 'bass', t: 0, voice: 'bass' }],
        sections: C_MAJOR,
      },
    )
    expect(minorV?.status).toBe('PASS')
    expect(notV?.status).toBe('PASS')
    expect(outside?.status).toBe('FAIL')
    expect(outside?.counts['outside']).toBe(1)
    expect(outside?.issues['outside']?.[0]?.msg).toMatch(/D7 \(D F# A C\) is outside C ionian/)
  })

  it("allows a minor piece's last chord on its tonic's major (Picardy), and refuses that chord anywhere else", () => {
    const DORIAN = [{ at: 0, end: 6, key: 'F#', mode: 'dorian', name: 'a' }]
    const SIX_NINE = [42, 49, 54, 58, 61, 63, 68] // F# major 6/9 as MIDI, as the scores voice it
    const [ending, midway] = check(
      {
        chords: [
          { t0: 0, t1: 2, tok: 'F#m9' },
          { t0: 2, t1: 4, tok: 'B9' },
          { t0: 4, t1: 6, tok: SIX_NINE }, // the F# major 6/9 ending
        ],
        notes: [
          { dur: 1.9, inst: 'sub', midi: 42, role: 'bass', t: 0, voice: 'bass' },
          { dur: 1.9, inst: 'sub', midi: 47, role: 'bass', t: 2, voice: 'bass' },
          { dur: 1.9, inst: 'sub', midi: 42, role: 'bass', t: 4, voice: 'bass' },
          { dur: 1.9, midi: 70, t: 4, voice: 'lead' }, // A#, the major third: in the Picardy chord only
        ],
        sections: DORIAN,
      },
      {
        chords: [
          { t0: 0, t1: 2, tok: SIX_NINE }, // the same chord first: a mode switch
          { t0: 2, t1: 4, tok: 'B9' },
          { t0: 4, t1: 6, tok: 'F#m9' },
        ],
        notes: [
          { dur: 1.9, inst: 'sub', midi: 42, role: 'bass', t: 0, voice: 'bass' },
          { dur: 1.9, midi: 70, t: 0, voice: 'lead' }, // A# over it: outside F# dorian
        ],
        sections: DORIAN,
      },
    )
    expect(ending?.status).toBe('PASS')
    expect(midway?.status).toBe('FAIL')
    expect(midway?.counts['outside']).toBe(1)
    expect(midway?.issues['outside']?.[0]?.msg).toMatch(
      /is outside F# dorian \(borrowed from the parallel major/,
    )
    expect(midway?.counts['keyNotes']).toBe(1)
  })

  it('checks a section with no key: a held pitch there fails, and its clashes count', () => {
    const [h] = check({
      chords: [],
      notes: [
        { dur: 4, inst: 'sub', midi: 42, role: 'bass', t: 0, voice: 'sub' }, // F#2
        { dur: 4, inst: 'pad', midi: 60, role: 'chord', t: 0, voice: 'pad' }, // C4: a tritone over it
        { dur: 0.5, midi: 73, t: 0, voice: 'lead' }, // C#5, a minor 2nd over the pad's C
        { dur: 0.05, inst: 'blip', midi: 84, t: 1, voice: 'tick' }, // a short tick needs no key
      ],
      sections: [{ at: 0, end: 4, key: null, mode: null, name: 'a' }],
    })
    expect(h?.status).toBe('FAIL')
    expect(h?.summary).toMatch(/^no key: 3 pitches held with no key/)
    expect(h?.counts['keyless']).toBe(3)
    expect(h?.clashes.count).toBe(2)
  })

  it('counts every note outside the key on any step; a pushed beat note is still on the beat', () => {
    const [h] = check({
      chords: [{ t0: 0, t1: 4, tok: 'C' }],
      notes: [
        ...PAD,
        // off-beat 8ths ('and'), short: not passing tones
        { dur: 0.2, midi: 78, t: 0.25, voice: 'lead' }, // F#5
        { dur: 0.2, midi: 73, t: 0.75, voice: 'lead' }, // C#5
        // a weak 16th, short, a leap from both neighbours
        { dur: 0.1, midi: 70, t: 1.125, voice: 'lead' }, // Bb4
        { dur: 0.2, midi: 76, t: 1.25, voice: 'lead' }, // E5
        // beat notes pushed 35 ms late: still on the beat
        { dur: 0.1, midi: 66, t: 2.035, voice: 'pulse' }, // F#4
        { dur: 0.1, midi: 61, t: 2.535, voice: 'pulse' }, // Db4
      ],
      sections: C_MAJOR,
    })
    expect(h?.counts['keyNotes']).toBe(5)
    const msgs = h?.issues['keyNotes']?.map((i) => i.msg).join('\n')
    expect(msgs).toMatch(/0.25 s lead F#5 over C: F# is outside C ionian \(on the 'and'\)/)
    expect(msgs).toMatch(/1.125 s lead Bb4 over C: Bb is outside C ionian$/m)
    expect(msgs).toMatch(/2.035 s pulse F#4 over C: F# is outside C ionian \(on a beat\)/)
  })

  it('judges a struck note by how long it rings, not by its gate', () => {
    const [h] = check({
      chords: [{ t0: 0, t1: 4, tok: 'C' }],
      notes: [
        ...PAD,
        // a long-decay pluck on weak 16ths, each a step from the next: the gate is short, the ring is not
        ...[78, 76, 78, 76].map((midi, i) => ({
          dur: 0.1,
          inst: 'pluck',
          midi,
          params: { decay: 1.2 },
          t: 0.125 + i * 0.25,
          voice: 'pluck',
        })),
      ],
      sections: C_MAJOR,
    })
    expect(h?.counts['keyNotes']).toBe(2) // the F#s ring 2.8 s
    expect(h?.issues['keyNotes']?.[0]?.msg).toMatch(/F# is outside C ionian/)
    expect(h?.clashes.count).toBeGreaterThan(0)
  })

  it("does not take an added tension as a chord tone in the clash check (B over Dm against the chord's F)", () => {
    const [h] = check({
      chords: [{ t0: 0, t1: 2, tok: 'Dm' }],
      notes: [
        ...[62, 65, 69].map((midi) => ({
          dur: 1.9,
          inst: 'pad',
          midi,
          role: 'chord' as const,
          t: 0,
          voice: 'pad',
        })),
        { dur: 1.7, midi: 71, t: 0, voice: 'lead' },
      ],
      sections: C_MAJOR,
    })
    expect(h?.status).toBe('FAIL')
    expect(h?.clashes.worst[0]).toMatchObject({ interval: 'tritone', notes: ['F4', 'B4'] })
  })

  it('refuses a note off the semitone', () => {
    const [h] = check({
      chords: [{ t0: 0, t1: 4, tok: 'C' }],
      notes: [...PAD, { dur: 0.9, inst: 'sine', midi: 72.4, t: 0, voice: 'sine' }],
      sections: C_MAJOR,
    })
    expect(h?.counts['tuning']).toBe(1)
    expect(h?.issues['tuning']?.[0]?.msg).toMatch(/MIDI 72.4 is 40 cents off the note/)
  })

  it('holds any low note to the bass rule, whatever plays it', () => {
    const [h] = check({
      chords: [
        { t0: 0, t1: 2, tok: 'C' },
        { t0: 2, t1: 4, tok: 'Am' },
      ],
      notes: [
        { dur: 1.8, inst: 'piano', midi: 38, t: 0, voice: 'piano' }, // D2 under C: a C/D
        { dur: 1.8, inst: 'piano', midi: 35, t: 2, voice: 'piano' }, // B1 under Am
        { dur: 1.8, inst: 'piano', midi: 40, t: 2.0001, voice: 'piano2' }, // E2 under Am: its fifth, fine
      ],
      sections: C_MAJOR,
    })
    expect(h?.counts['bass']).toBe(2)
  })

  it('hands every note-carrying or tuned event to the check (wood, ceramic, rattle, shing; not drum tunings)', () => {
    const url = (file: string) => pathToFileURL(path.join(AUDIO, file)).href
    const code = `
      import { isPitchedEvent, eventPitches, inharmonicWhy } from '${url('harmony.mjs')}';
      const ev = [
        { inst: 'ceramic', note: 78 }, { inst: 'wood', note: 71 }, { inst: 'rattle', note: 70 },
        { inst: 'shing', params: {} }, { inst: 'modal', note: 60, params: { f: 880 } }, { inst: 'tom', note: 50 }, { inst: 'clap' },
      ];
      process.stdout.write(JSON.stringify(ev.map(e => [e.inst, isPitchedEvent(e, 'x'), eventPitches(e).map(m => Math.round(m * 10) / 10), !!inharmonicWhy(e.inst, e.params ?? {})])));`
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
    })
    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual([
      ['ceramic', true, [78], true],
      ['wood', true, [71], true],
      ['rattle', true, [70], true],
      ['shing', true, [93.4], true],
      ['modal', true, [81], true],
      ['tom', false, [50], false],
      ['clap', false, [], false],
    ])
  })
})

/** Runs `score.mjs --harmony --json` on a fixture score in a scratch copy, with the repo's composer. */
function scoreHarmony(
  fixture: string,
  edit?: (music: string) => string,
): { exit: null | number; h: Harmony } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `harmony-${fixture}-`))
  try {
    fs.cpSync(path.join(FIXTURES, fixture), dir, { recursive: true })
    fs.cpSync(composerSourceDir(), path.join(dir, 'tools'), { recursive: true })
    const music = path.join(dir, 'music.mjs')
    if (edit) fs.writeFileSync(music, edit(fs.readFileSync(music, 'utf8')))
    const cues = fs.existsSync(path.join(dir, 'cues.json'))
      ? ['--cues', 'cues.json']
      : ['--no-cues']
    const run = spawnSync(
      process.execPath,
      ['tools/score.mjs', ...cues, '--harmony', '--json', '--quiet'],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, FFMPEG: 'ffmpeg-not-needed' },
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    const json = run.stdout.slice(run.stdout.indexOf('{'))
    if (!json) throw new Error(`score.mjs printed no JSON (exit ${run.status}): ${run.stderr}`)
    return { exit: run.status, h: JSON.parse(json) as Harmony }
  } finally {
    fs.rmSync(dir, { force: true, recursive: true })
  }
}

describe('the harmony check on real scores (score.mjs --harmony)', () => {
  it('fails the dissonant launch reel on every count that made it so', () => {
    const { exit, h } = scoreHarmony('launch-reel')
    expect(exit).toBe(3)
    expect(h).toMatchObject({ key: 'Eb', mode: 'lydian', status: 'FAIL' })
    expect(h.counts).toMatchObject({ chords: 4, key: 2, mode: 1, outside: 1, slash: 9 })
    expect(h.borrowed).toMatchObject([{ chord: 'Cbmaj7' }]) // the 'surprise' chord, now refused as outside the key
    expect(h.counts['inharmonic']).toBeGreaterThan(100)
    expect(h.clashes.count).toBeGreaterThan(100)
    expect(h.clashes.byInterval['tritone']).toBeGreaterThan(50)
    expect(h.issues['mode']?.[0]?.msg).toMatch(/Eb lydian is not an allowed mode/)
  }, 120_000)

  it('sees found sounds of every instrument kind holding a pitch (ceramic is foley, wood a drum)', () => {
    const { exit, h } = scoreHarmony('found-sounds')
    expect(exit).toBe(3)
    expect(h.counts['inharmonic']).toBe(16)
    const voices = new Set(h.issues['inharmonic']?.map((i) => i.msg.split(' ')[2]))
    expect([...voices].sort()).toEqual(['cer', 'wd'])
    expect(h.clashes.count).toBeGreaterThan(0)
  }, 120_000)

  it('fails the liked garage score on its borrowed Dmaj7 and the G# over it, and passes once that chord is in the key', () => {
    const asIs = scoreHarmony('garage-reel')
    expect(asIs.exit).toBe(3)
    expect(asIs.h).toMatchObject({ key: 'F#', mode: 'dorian', status: 'FAIL' })
    const { chords, clashes, inharmonic, keyNotes, nonchord, outside, ...rest } = asIs.h.counts
    // B9 (its tones all in F# dorian), the 1.4 bell and the F# 6/9 Picardy ending pass now; Dmaj7 (bVI, from the
    // parallel minor) is still outside the key, its D outside F# dorian, and the hook's G# over it is its #11
    expect({ chords, clashes, inharmonic, keyNotes, nonchord, outside }).toEqual({
      chords: 0,
      clashes: 1,
      inharmonic: 0,
      keyNotes: 31,
      nonchord: 4,
      outside: 5,
    })
    expect(Object.values(rest).every((n) => n === 0)).toBe(true)
    expect(asIs.h.borrowed.map((b) => b.chord)).toEqual(['Dmaj7', 'Dmaj7', 'Dmaj7', 'Dmaj7'])
    expect(asIs.h.issues['nonchord']?.map((i) => i.msg).join('\n')).toMatch(
      /lead G#5 over Dmaj7: on a beat, neither a chord tone \(D F# A C#\)/,
    )

    // The skill's recipe A: Amaj7 (IIImaj7) for the borrowed Dmaj7, the keys' motif on the tonic and IIImaj7 bars of
    // the build (its A sat over G#m7), the break's bell motif from the Amaj7 bar (its G# sat over B9's A), and the
    // approved kick for its elastic one (`--harmony` runs the kick check too).
    const fixed = scoreHarmony('garage-reel', (music) =>
      music
        .replace(
          "kick: { inst: 'kick', f0: 140, f1: 46, decay: 0.28, click: 0.35, gain: 0.95, harmonics: -8 }",
          "kick: { inst: 'kick', f0: 200, f1: 55, pitchTau: 0.008, decay: 0.1, click: 0.65, drive: 1.3, gain: 0.55 }",
        )
        .replace(
          "kick: { grid: 'x...............', f0: 110, decay: 0.4 }",
          "kick: { grid: 'x...............', gain: 0.8 }",
        )
        .replaceAll("'Dmaj7'", "'Amaj7'")
        .replace("motif: { voice: 'keys', every: 2, bar: 1 }", "motif: { voice: 'keys', every: 2 }")
        .replace(
          "motif: { voice: 'bell', transform: 'aug', every: 4 }",
          "motif: { voice: 'bell', transform: 'aug', every: 4, bar: 2 }",
        ),
    )
    expect(fixed.exit).toBe(0)
    expect(fixed.h.status).toBe('PASS')
    expect(fixed.h.summary).toMatch(
      /^F# dorian: \d+ pitched notes, every chord stable and in the key/,
    )
  }, 120_000)

  it('passes the owner-approved launch score (F# dorian, 7th and 9th chords, the 1.4 bell, the F# 6/9 ending)', () => {
    const { exit, h } = scoreHarmony('approved-launch-reel')
    expect(exit).toBe(0)
    expect(h).toMatchObject({ key: 'F#', mode: 'dorian', status: 'PASS' })
    expect(Object.values(h.counts).every((n) => n === 0)).toBe(true)
    expect(h.clashes.count).toBe(0)
    expect(h.borrowed).toEqual([])
    expect(h.summary).toMatch(
      /^F# dorian: \d+ pitched notes, every chord stable and in the key, no sustained clash/,
    )
  }, 120_000)
})
