/**
 * The composer's kick check (`tools/motion-composer/audio/kick.mjs`): the owner approved one kick
 * only and rejected the elastic "rubber band" kick (a slow pitch slide, a long tail, a harmonics
 * layer sliding with it) twice, after it had been "removed" from the skill and came back from its
 * recipes. These tests keep it out: the checker on hand-built events, `score.mjs --harmony` on
 * real scores, and every kick the composer skill and the composer's help show the agent.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { composerSourceDir } from './motion-composer'

const AUDIO = path.join(composerSourceDir(), 'audio')
const SKILL_DIR = path.join(
  path.dirname(path.dirname(composerSourceDir())),
  'skills',
  'reelmakeeasy-music-composer',
)
const SYNTHESIS = path.join(SKILL_DIR, 'references', 'music-synthesis.md')

type Ev = {
  cue?: boolean
  cueKind?: string
  dur?: number
  inst: string
  note?: number
  params?: Record<string, unknown>
  t: number
  voice: string
}
type Kick = {
  counts: { harmonics: number; kick: number; slide: number; thump: number }
  issues: { kind: string; msg: string; voice: string }[]
  status: 'FAIL' | 'PASS'
  summary: string
}
type Voices = Record<string, Record<string, unknown>>

/** The kick the owner approved (recipe D), as music.mjs writes it. */
const APPROVED = {
  click: 0.65,
  decay: 0.1,
  drive: 1.3,
  f0: 200,
  f1: 55,
  gain: 0.7,
  inst: 'kick',
  pitchTau: 0.008,
}
/** The kick in the agent's rejected reel (Opus Clip launch, 15 s): f0 150 -> 45, a 0.3 s tail, harmonics -6. */
const AGENT = { click: 0.35, decay: 0.3, f0: 150, f1: 45, gain: 0.72, harmonics: -6, inst: 'kick' }
/** The recipes' kicks before the fix (A garage, B minor launch, C pop-house), with the old pitchTau default. */
const OLD_RECIPES = {
  A: {
    click: 0.35,
    decay: 0.28,
    f0: 140,
    f1: 46,
    gain: 0.95,
    harmonics: -8,
    inst: 'kick',
    pitchTau: 0.03,
  },
  B: {
    click: 0.3,
    decay: 0.3,
    f0: 150,
    f1: 45,
    gain: 0.72,
    harmonics: -6,
    inst: 'kick',
    pitchTau: 0.03,
  },
  C: {
    click: 0.3,
    decay: 0.28,
    f0: 145,
    f1: 48,
    gain: 0.72,
    harmonics: -6,
    inst: 'kick',
    pitchTau: 0.03,
  },
}

/** Runs checkKick on each { events, voices } in a child node (the checker is the composer's own ESM). */
function check(...pieces: { duckBy?: string[]; events: Ev[]; voices: Voices }[]): Kick[] {
  const code = `
    import { checkKick } from '${pathToFileURL(path.join(AUDIO, 'kick.mjs')).href}';
    let raw = ''; process.stdin.on('data', d => (raw += d)).on('end', () => {
      process.stdout.write(JSON.stringify(JSON.parse(raw).map(p => checkKick(p))));
    });`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    input: JSON.stringify(pieces),
  })
  if (run.status !== 0) throw new Error(run.stderr)
  return JSON.parse(run.stdout) as Kick[]
}

/** A voice's kick hits on four beats, its params (all but composer keys) on each event, as compose.mjs passes them. */
function kickVoice(name: string, voice: Record<string, unknown>): { events: Ev[]; voices: Voices } {
  const { gain: _gain, harmonics: _harmonics, inst, ...params } = voice
  const events = [0, 0.5, 1, 1.5].map((t) => ({
    dur: 0.1,
    inst: String(inst),
    params,
    t,
    voice: name,
  }))
  return { events, voices: { [name]: voice } }
}

describe('the kick check on hand-built events', () => {
  it('passes the approved kick, and a bare kick voice (the instrument defaults are that kick)', () => {
    const [approved, bare] = check(
      kickVoice('kick', APPROVED),
      kickVoice('kick', { gain: 0.7, inst: 'kick' }),
    )
    expect(approved?.status).toBe('PASS')
    expect(bare?.status).toBe('PASS')
    expect(approved?.summary).toMatch(/^4 kick hits, every one tight/)
  })

  it("fails the agent's elastic kick on its tail and its harmonics layer, and on its slide when written out", () => {
    const [agent, slow] = check(
      kickVoice('kick', AGENT),
      kickVoice('kick', { ...AGENT, pitchTau: 0.03 }),
    )
    expect(agent?.status).toBe('FAIL')
    expect(agent?.issues).toHaveLength(1)
    expect(agent?.issues[0]?.msg).toMatch(
      /voice "kick" \(kick\) is an elastic kick: decay 0\.3 s > 0\.15/,
    )
    expect(agent?.issues[0]?.msg).toMatch(/a harmonics layer \(-6 dB\) that slides with its pitch/)
    expect(agent?.issues[0]?.msg).toMatch(
      /Use the approved kick: \{ inst: 'kick', f0: 200, f1: 55, pitchTau: 0\.008, decay: 0\.1, click: 0\.65, drive: 1\.3, gain: 0\.7 \} with no harmonics \(4 hits, the first at 0 s\)/,
    )
    expect(slow?.issues[0]?.msg).toMatch(
      /pitchTau 0\.03 s > 0\.012 \(a slow, audible pitch slide\)/,
    )
  })

  it('fails every recipe kick from before the fix, and each limit on its own', () => {
    const results = check(
      ...Object.values(OLD_RECIPES).map((k) => kickVoice('kick', k)),
      kickVoice('kick', { ...APPROVED, pitchTau: 0.013 }),
      kickVoice('kick', { ...APPROVED, decay: 0.16 }),
      kickVoice('kick', { ...APPROVED, harmonics: -8 }),
      kickVoice('kick', { ...APPROVED, pitchTau: 0.012, decay: 0.15 }),
    )
    expect(results.map((r) => r.status)).toEqual([
      'FAIL',
      'FAIL',
      'FAIL',
      'FAIL',
      'FAIL',
      'FAIL',
      'PASS',
    ])
  })

  it('treats a voice named as a kick as a kick, whatever plays it', () => {
    const [e808, sub, short808] = check(
      kickVoice('kick', { decay: 0.4, inst: 'e808', note: 36, slide: 12 }),
      {
        events: [{ dur: 0.5, inst: 'sub', note: 36, t: 0, voice: 'bd' }],
        voices: { bd: { inst: 'sub' } },
      },
      {
        events: [
          { dur: 0.1, inst: 'e808', note: 36, params: { decay: 0.1 }, t: 0, voice: 'kick808' },
        ],
        voices: { kick808: { inst: 'e808' } },
      },
    )
    expect(e808?.issues[0]?.msg).toMatch(/is an elastic kick: a slide 12 glide/)
    expect(sub?.issues[0]?.msg).toMatch(/a sub held 0\.5 s > 0\.15/)
    expect(short808?.status).toBe('PASS')
  })

  it('fails a sliding 808 hit (down, or any glide as a cue or raw hit), and allows an upward 808 slide in a line', () => {
    const drop = { decay: 0.9, glide: 0.12, inst: 'e808' }
    const [cue, line, up, raw] = check(
      {
        events: [
          {
            cue: true,
            cueKind: 'boom',
            dur: 0.9,
            inst: 'e808',
            note: 27,
            params: { decay: 0.9, from: 39, glide: 0.12 },
            t: 1,
            voice: 'drop',
          },
        ],
        voices: { drop },
      },
      {
        events: [
          { dur: 0.4, inst: 'e808', note: 36, params: { from: 43 }, t: 0, voice: 'bass808' },
        ],
        voices: { bass808: { inst: 'e808' } },
      },
      {
        events: [
          { dur: 0.4, inst: 'e808', note: 43, params: { from: 36 }, t: 0, voice: 'bass808' },
        ],
        voices: { bass808: { inst: 'e808' } },
      },
      {
        events: [
          { dur: 0.4, inst: 'e808', note: 36, params: { slide: -5 }, t: 0, voice: 'inst:e808' },
        ],
        voices: {},
      },
    )
    expect(cue?.issues[0]).toMatchObject({ kind: 'slide', voice: 'drop' })
    expect(cue?.issues[0]?.msg).toMatch(
      /the boom cue \(drop\) \(e808\) slides on a hit, the rubber band: a from 39 to 27 glide over 0\.12 s/,
    )
    expect(line?.issues[0]?.kind).toBe('slide')
    expect(up?.status).toBe('PASS')
    expect(raw?.issues[0]?.msg).toMatch(/a raw instrument hit \(e808\) slides on a hit/)
  })

  it('forbids a harmonics layer on any voice whose pitch moves, and keeps it on a steady bass line', () => {
    const [porta, logdrum, steady] = check(
      {
        events: [
          { dur: 0.3, inst: 'acid', note: 36, t: 0, voice: 'acid' },
          { dur: 0.3, inst: 'acid', note: 43, params: { from: 36 }, t: 0.5, voice: 'acid' },
        ],
        voices: { acid: { harmonics: -8, inst: 'acid', porta: true } },
      },
      {
        events: [{ dur: 0.3, inst: 'logdrum', note: 40, t: 0, voice: 'log' }],
        voices: { log: { harmonics: -8, inst: 'logdrum' } },
      },
      {
        events: [{ dur: 0.3, inst: 'sawBass', note: 36, t: 0, voice: 'bass' }],
        voices: { bass: { harmonics: -8, inst: 'sawBass' } },
      },
    )
    expect(porta?.issues[0]).toMatchObject({ kind: 'harmonics', voice: 'acid' })
    expect(porta?.issues[0]?.msg).toMatch(
      /has a harmonics layer and its pitch moves, so the layer slides with it/,
    )
    expect(logdrum?.issues[0]?.msg).toMatch(/drop 12 semitones \(12 semitones\) over 0\.012 s/)
    expect(steady?.status).toBe('PASS')
  })

  /** One voice's hits on four beats with `dur`, its params (all but composer keys) on each event. */
  const onBeats = (name: string, voice: Record<string, unknown>, dur = 0.4) => {
    const piece = kickVoice(name, voice)
    return { ...piece, events: piece.events.map((e) => ({ ...e, dur })) }
  }

  it('fails the elastic kick under another name: a sliding thump played as a beat, whatever plays it', () => {
    // The rejected kick's shape on other instruments, each on four beats in a voice not named kick.
    const thumps = check(
      onBeats('thump', { bend: 1.5, decay: 0.3, inst: 'tom', note: 28 }),
      onBeats('thump', { bend: 1.5, decay: 0.3, inst: 'conga', note: 28 }),
      onBeats('thump', { decay: 0.3, fall: 9, inst: 'boom' }),
      onBeats('thump', { decay: 0.3, drop: 12, dropTime: 0.04, inst: 'logdrum', note: 45 }),
      onBeats('thump', { bubbles: 0, decay: 0.3, f0: 150, f1: 45, inst: 'bloop' }, 0.3),
      onBeats('thump', { f0: 150, f1: 45, inst: 'sweep' }, 0.3),
      onBeats('thump', { f: 90, inst: 'gel' }, 0.3),
      onBeats('thump', { inst: 'e808', note: 36, slide: -7 }, 0.6),
    )
    for (const r of thumps) {
      expect(r.status).toBe('FAIL')
      expect(r.issues[0]).toMatchObject({ kind: 'thump', voice: 'thump' })
      expect(r.issues[0]?.msg).toMatch(
        /is the elastic kick under another name: a sliding thump played as a beat: .*Use the approved kick|or use the approved kick for the beat/,
      )
    }
    // One or two impacts (a boom at the drop and the payoff), a tight tom, a high conga pass.
    const [impacts, tightTom, highConga] = check(
      {
        events: [0, 2].map((t) => ({ dur: 0.4, inst: 'boom', t, voice: 'boom' })),
        voices: { boom: { inst: 'boom' } },
      },
      onBeats('tom', { bend: 0.6, decay: 0.12, inst: 'tom', note: 41 }),
      onBeats('conga', { inst: 'conga', note: 62 }),
    )
    expect(impacts?.status).toBe('PASS')
    expect(tightTom?.status).toBe('PASS')
    expect(highConga?.status).toBe('PASS')
  })

  it('holds a voice the mix ducks on (mix.duck.by) to the kick, whatever plays it', () => {
    const ducked = (voice: Record<string, unknown>, dur = 0.12) => ({
      ...onBeats('thump', voice, dur),
      duckBy: ['thump'],
    })
    const [pulse, snare, approvedThump, cueOnly] = check(
      ducked({ decay: 0.3, glide: 0.06, inst: 'pulse', slide: 12 }),
      ducked({ body: 60, decay: 0.3, drop: 2, inst: 'snare', mix: 0 }),
      ducked({ ...APPROVED, inst: 'kick' }),
      // A cue kind in duck.by (a boom cue ducking the mix at the drop) is no kick.
      {
        duckBy: ['boom'],
        events: [{ cue: true, cueKind: 'boom', dur: 0.4, inst: 'boom', t: 1, voice: 'boom' }],
        voices: { boom: { inst: 'boom' } },
      },
    )
    expect(pulse?.issues[0]?.msg).toMatch(
      /voice "thump" \(pulse\) ducks the mix \(mix\.duck\.by\), so it is the kick, and it is an elastic kick: a slide 12 \(12 semitones\) lasting 0\.06 s > 0\.012/,
    )
    expect(snare?.issues[0]?.msg).toMatch(/body drop 2 .* lasting 0\.02 s > 0\.012/)
    expect(approvedThump?.status).toBe('PASS')
    expect(cueOnly?.status).toBe('PASS')
  })
})

/** A small score around one kick voice: 2 bars of four-on-the-floor in A minor over a steady bass. */
const tinyScore = (kick: Record<string, unknown>) => `export default ({ config }) => ({
  bpm: config.bpm, meter: config.meter, key: 'A', mode: 'aeolian', seed: 1,
  voices: { kick: ${JSON.stringify(kick)}, bass: { inst: 'sawBass', octave: 1, gain: 0.5, harmonics: -8 } },
  progression: ['i'], chordBars: 2,
  grids: { main: { kick: 'X...X...X...X...', bass: '..R...R...R...R.' } },
  sections: [{ name: 'main', bars: 2, energy: 2, grid: 'main' }],
});
`

/** Runs `score.mjs --no-cues --harmony --json` on a music.mjs in a scratch reel folder, with the repo's composer. */
function scoreChecks(
  music: string,
  bpm: number,
  seconds: number,
): { exit: null | number; harmony: string; kick: Kick } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-'))
  try {
    fs.cpSync(composerSourceDir(), path.join(dir, 'tools'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'music.mjs'), music)
    fs.writeFileSync(
      path.join(dir, 'reel.config.mjs'),
      `export default { title: 't', bpm: ${bpm}, meter: '4/4', duration: ${seconds}, fps: 30, audio: { ending: 'ring', lufs: -14, tp: -1 } };\n`,
    )
    const run = spawnSync(
      process.execPath,
      ['tools/score.mjs', '--no-cues', '--harmony', '--json', '--quiet'],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, FFMPEG: 'ffmpeg-not-needed' },
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    const json = run.stdout.slice(run.stdout.indexOf('{'))
    if (!json) throw new Error(`score.mjs printed no JSON (exit ${run.status}): ${run.stderr}`)
    const out = JSON.parse(json) as { kick: Kick; status: string }
    return { exit: run.status, harmony: out.status, kick: out.kick }
  } finally {
    fs.rmSync(dir, { force: true, recursive: true })
  }
}

/** The four recipes of the skill's section 16, as complete music.mjs files, with the tempo and length their heading gives. */
function recipes(): { bpm: number; code: string; name: string; seconds: number }[] {
  const md = fs.readFileSync(SYNTHESIS, 'utf8')
  const found = [
    ...md.matchAll(
      /^### ([A-D])\. [^\n]*?(\d+) BPM, (\d+) s[^\n]*\n[\s\S]*?```js\n([\s\S]*?)```/gm,
    ),
  ]
  return found.map((m) => ({
    bpm: Number(m[2]),
    code: m[4] ?? '',
    name: m[1] ?? '',
    seconds: Number(m[3]),
  }))
}

describe('the kick check on real scores (score.mjs --harmony)', () => {
  it("exits 3 on the agent's kick and passes the approved one", () => {
    const agent = scoreChecks(tinyScore(AGENT), 128, 3.75)
    expect(agent.exit).toBe(3)
    expect(agent.harmony).toBe('PASS')
    expect(agent.kick).toMatchObject({ counts: { kick: 1 }, status: 'FAIL' })
    const approved = scoreChecks(tinyScore(APPROVED), 128, 3.75)
    expect(approved.exit).toBe(0)
    expect(approved.kick.status).toBe('PASS')
    for (const old of Object.values(OLD_RECIPES))
      expect(scoreChecks(tinyScore(old), 128, 3.75).kick.status).toBe('FAIL')
  }, 120_000)

  it('exits 3 on the rejected kick renamed and played by a tom, ducked on or not', () => {
    const renamed = (duck: boolean) =>
      tinyScore(AGENT)
        .replace(
          /voices: \{ kick: [^}]*\}/,
          "voices: { thump: { inst: 'tom', note: 28, bend: 1.5, decay: 0.3, gain: 0.7 }",
        )
        .replace('grids: { main: { kick:', 'grids: { main: { thump:')
        .replace(
          'sections: [',
          duck ? "mix: { duck: { by: ['thump'], depth: 0.4 } },\n  sections: [" : 'sections: [',
        )
    const ducked = scoreChecks(renamed(true), 128, 3.75)
    expect(ducked.exit).toBe(3)
    expect(ducked.kick.issues[0]).toMatchObject({ kind: 'kick', voice: 'thump' })
    const plain = scoreChecks(renamed(false), 128, 3.75)
    expect(plain.exit).toBe(3)
    expect(plain.kick.issues[0]).toMatchObject({ kind: 'thump', voice: 'thump' })
  }, 120_000)

  it('passes every recipe in the composer skill: the harmony and the kick checks (each plays the approved kick)', () => {
    const all = recipes()
    expect(all.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D'])
    for (const r of all) {
      const { exit, harmony, kick } = scoreChecks(r.code, r.bpm, r.seconds)
      expect({ exit, harmony, kick: kick.status, name: r.name }).toEqual({
        exit: 0,
        harmony: 'PASS',
        kick: 'PASS',
        name: r.name,
      })
    }
  }, 240_000)
})

describe('every kick the agent is shown', () => {
  /** Every `{ ... inst: 'kick' ... }` object literal written in a file, its numeric keys read. */
  const kicksIn = (text: string) =>
    [...text.matchAll(/\{[^{}]*inst: 'kick'[^{}]*\}/g)].map((m) => {
      const num = (k: string) => {
        const v = new RegExp(`\\b${k}: (-?[\\d.]+)`).exec(m[0])
        return v ? Number(v[1]) : undefined
      }
      return {
        decay: num('decay'),
        harmonics: /\bharmonics:/.test(m[0]),
        pitchTau: num('pitchTau'),
        text: m[0],
      }
    })
  const files = [
    path.join(SKILL_DIR, 'SKILL.md'),
    ...fs
      .readdirSync(path.join(SKILL_DIR, 'references'))
      .map((f) => path.join(SKILL_DIR, 'references', f)),
    path.join(composerSourceDir(), 'README.md'),
    path.join(composerSourceDir(), 'score.mjs'),
  ]

  it('is the approved kick: no slow slide, no long tail, no harmonics layer', () => {
    const kicks = files.flatMap((f) =>
      kicksIn(fs.readFileSync(f, 'utf8')).map((k) => ({ ...k, file: path.basename(f) })),
    )
    expect(kicks.length).toBeGreaterThanOrEqual(6)
    for (const k of kicks) {
      expect({ file: k.file, harmonics: k.harmonics, text: k.text }).toEqual({
        file: k.file,
        harmonics: false,
        text: k.text,
      })
      expect(k.pitchTau ?? 0.008).toBeLessThanOrEqual(0.012)
      expect(k.decay ?? 0.1).toBeLessThanOrEqual(0.15)
    }
  })

  it('has no elastic kick recipe or "tune the kick" advice in the skill, and no harmonics advice for the kick', () => {
    const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
    expect(text).not.toMatch(/τ 20–40 ms|decay 0\.15–0\.4 s|tune the kick/)
    expect(text).not.toMatch(/`kick e808 sub logdrum acid sawBass reese`/)
    expect(text).not.toMatch(/The top row is usually the kick-like voice\./)
    const help = spawnSync(
      process.execPath,
      [path.join(composerSourceDir(), 'score.mjs'), '--list'],
      { encoding: 'utf8' },
    )
    expect(help.stdout).toMatch(
      /\n +kick +f0 200 .*f1 55 .*pitchTau \.008 .*decay \.1 .*click \.65 .*drive 1\.3/,
    )
    expect(help.stdout).not.toMatch(/f0 150 \(Hz, pitch start\)/)
  })
})
