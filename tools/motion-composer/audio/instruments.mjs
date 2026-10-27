// Sample-free instrument library. Every voice is oscillators, noise, envelopes and filters: deterministic,
// no samples, no downloads. `node tools/score.mjs --list` prints this registry with each instrument's parameters.
//
// Contract: INST[name].play(o, t, p)
//   o = { bus, rand, bpm }   bus: a dsp.Bus to write into, rand: seeded rng for this voice, bpm: reel tempo
//   t = start time in seconds
//   p = { note (MIDI, may be fractional) | notes (array, for chord instruments), vel 0..1, gain, pan -1..1,
//         send (reverb send 0..1), dsend (delay send), dur (s, sustain length where it applies),
//         cut (absolute seconds: choke the voice there with a 5 ms fade), ...instrument parameters }
// Parameters in `doc` are "name default" pairs. Ratios marked (physics) are standard acoustics; everything
// else is a tunable starting value (03 §4.3, 01 §3.7). Modal ratio labels follow critique C10:
//   1 : 2.756 : 5.404 : 8.933 = free-free BAR modes (glockenspiel, untuned bars, wood bars)
//   1 : 4 : 10               = TUNED bars (marimba bars are undercut so their overtones sit at 4x and 10x)
//   1 : 1.594 : 2.136 : ...  = ideal circular MEMBRANE modes (drum-like; gong-like with long decays)
//   glass 1 : 2.32 : 4.25 : 6.63 = starting values only, not physics; tune with the spectrogram.
// Remember the realism caveat (critique G4): acoustic idioms from these voices read as toy/FM/lo-fi versions.
// Pick the stylised route on purpose, or use an external track, and tell the user what you could not hear.

import { KICK_DEFAULTS, LOGDRUM_DROP_TIME } from './kick.mjs';
import { SR, TAU, S, clamp, mtof, saw, sqr, pulse, tri, pan, drive, lp1, hp1, biquad, svf, sinOsc, adExp, ahr } from './dsp.mjs';

export const INST = {};
/** register an instrument. kind decides the default bus: drum -> beat, tonal|texture -> music, fx|foley -> sfx */
function def(name, kind, send, doc, play) { INST[name] = { name, kind, send, doc, play }; }

/** per-note writer: gain * velocity, constant-power pan (centre = unity), sends, optional choke */
function W(o, p, defSend = 0) {
  const g = (p.gain ?? 1) * (p.vel ?? 1), [pl, pr] = pan(p.pan ?? 0);
  const send = p.send ?? defSend, ds = p.dsend ?? 0, bus = o.bus;
  const cutI = p.cut != null ? S(p.cut) : Infinity, F = 240;
  return (i, l, r = l) => {
    let k = g;
    if (i >= cutI - F) { if (i >= cutI) return; k *= (cutI - i) / F; }
    bus.add(i, l * k * pl, r * k * pr, send, ds);
  };
}
/** number of samples to render from s0 for `sec` seconds, clipped to the bus */
const N = (o, s0, sec) => Math.max(0, Math.min(Math.ceil(sec * SR), o.bus.n - s0));
const noiseOf = o => () => o.rand() * 2 - 1;
const notesOf = p => (p.notes && p.notes.length ? p.notes : [p.note ?? 60]);
const fOf = (p, dflt = 60) => (p.f ?? mtof(p.note ?? dflt));

// =============================================================== DRUMS AND PERCUSSION
// ReelMakeEasy: the defaults are the one kick the owner approved (audio/kick.mjs); the kick check fails pitchTau > .012,
// decay > .15 or a harmonics layer on a kick (the elastic "rubber band" kick it rejected).
def('kick', 'drum', 0, 'f0 200 (Hz, pitch start) · f1 55 (Hz, end) · pitchTau .008 (s; the kick check fails > .012) · decay .1 (s; fails > .15) · click .65 · drive 1.3 (the approved kick; no harmonics layer on a kick)', (o, t, p) => {
  const K = KICK_DEFAULTS, w = W(o, p, 0), s0 = S(t), f0 = p.f0 ?? K.f0, f1 = p.f1 ?? K.f1, pt = p.pitchTau ?? K.pitchTau, dec = p.decay ?? K.decay, ck = p.click ?? K.click, dr = p.drive ?? K.drive, nz = noiseOf(o), h = hp1(1200);
  const n = N(o, s0, Math.min(3, dec * 7 + 0.03)), cn = Math.round(0.004 * SR); let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = i / SR; ph += TAU * (f1 + (f0 - f1) * Math.exp(-x / pt)) / SR;
    let v = Math.sin(ph) * Math.exp(-x / dec) * Math.min(1, i / 24);
    if (i < cn) v += h(nz()) * ck * (1 - i / cn);
    w(s0 + i, (dr ? drive(v, dr) : v) * 0.9);
  }
});
def('e808', 'drum', 0, 'note · dur · from (MIDI, glide start) or slide (semitones from the note) · glide .08 (s) · drive 1.6 · decay 1.1 (s)', (o, t, p) => {
  const w = W(o, p, 0), s0 = S(t), f1 = mtof(p.note ?? 36), f0 = p.from != null ? mtof(p.from) : p.slide ? mtof((p.note ?? 36) + p.slide) : f1, gl = p.glide ?? 0.08, dur = p.dur ?? 0.6, dr = p.drive ?? 1.6, dec = p.decay ?? 1.1;
  const n = N(o, s0, dur + 0.02); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += TAU * (f0 + (f1 - f0) * clamp(x / gl)) / SR;
    const env = Math.min(1, x * 300) * Math.exp(-x / dec) * Math.min(1, (dur - x) * 30); w(s0 + i, Math.tanh(Math.sin(ph) * dr) * env * 0.5); }
});
def('clap', 'drum', 0.38, 'tone 1450 (Hz band) · spread .0105 (s between bursts) · bursts 3 · decay .07 (s)', (o, t, p) => {
  const w = W(o, p, 0.38), s0 = S(t), f = biquad('bp', p.tone ?? 1450, 0.85), h = hp1(650), sp = p.spread ?? 0.0105, nb = p.bursts ?? 3, dec = p.decay ?? 0.07, nz = noiseOf(o);
  const n = N(o, s0, 0.06 + dec * 5);
  for (let i = 0; i < n; i++) { const x = i / SR, env = (x < sp * nb ? Math.exp(-((x % sp) * 300)) : 1) * Math.exp(-x / dec); const v = h(f(nz())) * env * 1.35; w(s0 + i, v * 0.9, v); }
});
def('snare', 'drum', 0.25, 'body 190 (Hz) · drop .3 (body pitch fall) · wires 1800 (Hz HP) · decay .05 (s) · gated false (cut tail at .26 s) · mix .6 (wires share)', (o, t, p) => {
  const gated = !!p.gated, w = W(o, p, gated ? 0.7 : 0.25), s0 = S(t), h = hp1(p.wires ?? 1800), body = p.body ?? 190, drop = p.drop ?? 0.3, dec = p.decay ?? 0.05, mix = p.mix ?? 0.6, nz = noiseOf(o);
  const len = gated ? 0.32 : Math.max(0.12, dec * 6), n = N(o, s0, len); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += TAU * body * (1 + drop * Math.exp(-x / 0.02)) / SR;
    const env = gated ? (x < 0.26 ? 1 : Math.exp(-(x - 0.26) * 80)) * Math.exp(-x * 3) : Math.exp(-x / dec);
    w(s0 + i, h(nz()) * env * mix * 1.15 + Math.sin(ph) * Math.exp(-x / 0.033) * (1 - mix) * 1.0); }
});
const HAT808 = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];   // six square oscillators (classic drum-machine practice)
def('hat', 'drum', 0.08, "mode 'noise'|'metal' · open false · decay (s; closed .012, open .08) · tune 1 · tone 7800 (Hz HP)", (o, t, p) => {
  const w = W(o, p, 0.08), s0 = S(t), open = !!p.open, dec = p.decay ?? (open ? 0.08 : 0.012), metal = p.mode === 'metal', tune = p.tune ?? 1, nz = noiseOf(o);
  const h = hp1(p.tone ?? 7800), b = biquad('bp', 9000, 0.9), h2 = biquad('hp', 7000, 0.7), n = N(o, s0, dec * 6 + 0.01), ph = HAT808.map(() => o.rand());
  for (let i = 0; i < n; i++) {
    let v;
    if (metal) { v = 0; for (let k = 0; k < 6; k++) { ph[k] += HAT808[k] * tune / SR; v += sqr(ph[k]); } v = h2(b(v / 6)) * 2.2 + h(nz()) * 0.15; }
    else v = h(nz());
    w(s0 + i, v * Math.exp(-i / SR / dec) * 0.32);
  }
});
def('ride', 'drum', 0.2, 'decay 1.5 (s) · tune 1 · ping .5 (bell share)', (o, t, p) => {
  const w = W(o, p, 0.2), s0 = S(t), dec = p.decay ?? 1.5, tune = p.tune ?? 1, ping = p.ping ?? 0.5, nz = noiseOf(o), h = hp1(5000);
  const fr = [3150, 3755, 4430, 5210, 6390, 7615].map(f => f * tune), osc = fr.map(f => sinOsc(f, o.rand() * TAU)), n = N(o, s0, dec * 5);
  for (let i = 0; i < n; i++) { const x = i / SR; let v = 0; for (let k = 0; k < 6; k++) v += osc[k]() * (1 - k * 0.1);
    w(s0 + i, (v / 6 * ping * Math.exp(-x / dec) + h(nz()) * (1 - ping) * Math.exp(-x / (dec * 0.25))) * 0.16 * Math.min(1, i / 20)); }
});
def('shaker', 'drum', 0.1, 'tone 7500 (Hz band) · attack .01 · decay .06', (o, t, p) => {
  const w = W(o, p, 0.1), s0 = S(t), b = biquad('bp', p.tone ?? 7500, 1.2), a = p.attack ?? 0.01, dec = p.decay ?? 0.06, nz = noiseOf(o), n = N(o, s0, a + dec * 6);
  for (let i = 0; i < n; i++) w(s0 + i, b(nz()) * adExp(i / SR, a, dec) * 0.5);
});
def('rim', 'drum', 0.15, 'f1 500 · f2 1700 (Hz partials) · decay .018', (o, t, p) => {
  const w = W(o, p, 0.15), s0 = S(t), f1 = p.f1 ?? 500, f2 = p.f2 ?? 1700, dec = p.decay ?? 0.018, nz = noiseOf(o), n = N(o, s0, dec * 7);
  for (let i = 0; i < n; i++) { const x = i / SR; w(s0 + i, (Math.sin(TAU * f1 * x) * 0.6 + Math.sin(TAU * f2 * x) * 0.5) * Math.exp(-x / dec) * 0.5 + (i < 96 ? nz() * 0.3 * (1 - i / 96) : 0)); }
});
def('cowbell', 'drum', 0.15, 'f1 540 · f2 800 (Hz squares) · decay .2 (tail)', (o, t, p) => {
  const w = W(o, p, 0.15), s0 = S(t), f1 = p.f1 ?? 540, f2 = p.f2 ?? 800, dec = p.decay ?? 0.2, b = biquad('bp', 2000, 0.8), n = N(o, s0, dec * 6);
  let a = 0, c = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; a += f1 / SR; c += f2 / SR; w(s0 + i, b(sqr(a) + sqr(c)) * (0.6 * Math.exp(-x / 0.015) + 0.4 * Math.exp(-x / dec)) * 0.35); }
});
def('tom', 'drum', 0.35, 'note (MIDI) · bend .6 (pitch overshoot) · decay .2 · noise .15', (o, t, p) => {
  const w = W(o, p, 0.35), s0 = S(t), f = mtof(p.note ?? 45), bend = p.bend ?? 0.6, dec = p.decay ?? 0.2, nzg = p.noise ?? 0.15, nz = noiseOf(o), n = N(o, s0, dec * 5); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += TAU * f * (1 + bend * Math.exp(-x * 25)) / SR; w(s0 + i, (Math.sin(ph) * Math.exp(-x / dec) + nz() * nzg * Math.exp(-x * 30)) * 0.8); }
});
def('conga', 'drum', 0.2, 'note 62 · bend .4 · decay .25 · slap 0 (0..1, 2 kHz noise burst)', (o, t, p) => {
  const w = W(o, p, 0.2), s0 = S(t), f = mtof(p.note ?? 62), bend = p.bend ?? 0.4, dec = p.decay ?? 0.25, slap = p.slap ?? 0, b = biquad('bp', 2000, 1.5), nz = noiseOf(o), n = N(o, s0, dec * 5); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += TAU * f * (1 + bend * Math.exp(-x / 0.015)) / SR; w(s0 + i, Math.sin(ph) * Math.exp(-x / dec) * 0.6 + (x < 0.012 ? b(nz()) * slap * 1.5 * (1 - x / 0.012) : 0)); }
});
def('logdrum', 'drum', 0.15, 'note (plays bass lines) · drop 12 (semitones above) · dropTime .012 (s; the kick check fails a slower drop down to <= 120 Hz with decay > .15 played as a beat) · decay .25 · drive 3 · knock 1 (1:1 FM index) · shape .3 (0 sine..1 triangle) · from (glide start) · glide .06 (s)', (o, t, p) => {
  const w = W(o, p, 0.15), s0 = S(t), fN = mtof(p.note ?? 45), fFrom = p.from != null ? mtof(p.from) : fN, drop = p.drop ?? 12, dt = p.dropTime ?? LOGDRUM_DROP_TIME, dec = p.decay ?? 0.25, dr = p.drive ?? 3, knock = p.knock ?? 1, shape = p.shape ?? 0.3, gl = Math.max(1e-4, p.glide ?? 0.06);
  const n = N(o, s0, dec * 6), lp = lp1(3000); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR, base = fFrom + (fN - fFrom) * clamp(x / gl), f = base * Math.pow(2, drop / 12 * Math.exp(-x / dt));
    ph += f / SR; const idx = knock * Math.exp(-x / 0.02), car = ph + idx * Math.sin(TAU * ph) / TAU;
    const v = Math.sin(TAU * car) * (1 - shape) + tri(car) * shape; w(s0 + i, lp(drive(v, dr)) * adExp(x, 0.001, dec) * 0.55); }
});
def('taiko', 'drum', 0.6, 'f 62 (Hz) or note · decay 1.1 · slap .4', (o, t, p) => {
  const w = W(o, p, 0.6), s0 = S(t), f = p.f ?? (p.note != null ? mtof(p.note) : 62), dec = p.decay ?? 1.1, slap = p.slap ?? 0.4, lp = lp1(1800), nz = noiseOf(o), n = N(o, s0, dec * 5); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += TAU * f * (1 + 0.25 * Math.exp(-x / 0.03)) / SR; w(s0 + i, (Math.sin(ph) * Math.exp(-x / dec) + (x < 0.015 ? lp(nz()) * slap * (1 - x / 0.015) * 2 : 0)) * 0.9); }
});
def('body', 'drum', 0.2, "part 'chest'|'thigh'|'snap'|'stomp'", (o, t, p) => {
  const w = W(o, p, 0.2), s0 = S(t), ty = p.part ?? (p.type !== 'body' ? p.type : null) ?? 'chest', nz = noiseOf(o);
  if (ty === 'chest' || ty === 'stomp') { const f = ty === 'stomp' ? 55 : 70, dec = ty === 'stomp' ? 0.22 : 0.12, lp = lp1(400), n = N(o, s0, dec * 5);
    for (let i = 0; i < n; i++) { const x = i / SR; w(s0 + i, (Math.sin(TAU * f * x) * 0.8 + lp(nz()) * 1.6) * Math.exp(-x / dec) * 0.8); } }
  else { const fc = ty === 'snap' ? 2600 : 1000, dec = ty === 'snap' ? 0.008 : 0.03, b = biquad('bp', fc, 1.4), n = N(o, s0, dec * 6);
    for (let i = 0; i < n; i++) { const x = i / SR; w(s0 + i, (b(nz()) * 1.8 + (ty === 'snap' && i < 48 ? 0.5 : 0)) * Math.exp(-x / dec)); } }
});
def('brush', 'drum', 0.2, "mode 'swirl'|'tap' · dur (swirl length) · rate (swirls per second, default one per beat) · tone 4000", (o, t, p) => {
  const w = W(o, p, 0.2), s0 = S(t), nz = noiseOf(o);
  if (p.mode === 'tap') { const b = biquad('bp', p.tone ?? 3000, 0.9), n = N(o, s0, 0.08); for (let i = 0; i < n; i++) w(s0 + i, b(nz()) * Math.exp(-i / SR / 0.04) * 0.9); return; }
  const dur = p.dur ?? 60 / (o.bpm || 120), rate = p.rate ?? (o.bpm || 120) / 60, lp = lp1(p.tone ?? 4000), hp = hp1(600), n = N(o, s0, dur + 0.05);
  for (let i = 0; i < n; i++) { const x = i / SR, ph = x * rate, a = Math.pow(Math.abs(Math.sin(Math.PI * ph)), 1.5) * Math.min(1, (dur + 0.05 - x) * 20), v = hp(lp(nz())) * a * 0.35, r = Math.sin(TAU * ph * 0.5) * 0.4;
    w(s0 + i, v * (1 - r), v * (1 + r)); }
});
def('chipnoise', 'drum', 0.05, "mode 'long'|'short' (93-step metallic) · clock 12000 (Hz) · decay .08", (o, t, p) => {
  const w = W(o, p, 0.05), s0 = S(t), short = p.mode === 'short', clock = p.clock ?? 12000, dec = p.decay ?? 0.08, n = N(o, s0, dec * 6);
  let reg = 1, acc = 0, out = 1;
  for (let i = 0; i < n; i++) { acc += clock / SR; while (acc >= 1) { acc -= 1; const fb = (reg & 1) ^ ((reg >> (short ? 6 : 1)) & 1); reg = (reg >> 1) | (fb << 14); out = reg & 1 ? 1 : -1; }
    w(s0 + i, out * Math.exp(-i / SR / dec) * 0.22); }
});
def('tick', 'drum', 0.05, 'f 4200 (Hz band) · decay .004', (o, t, p) => {
  const w = W(o, p, 0.05), s0 = S(t), f = biquad('bp', p.f ?? 4200, 4), dec = p.decay ?? 0.004, nz = noiseOf(o), n = N(o, s0, Math.max(0.02, dec * 6));
  for (let i = 0; i < n; i++) { const v = f(nz()) * Math.exp(-i / SR / dec) * 1.8; w(s0 + i, v * 0.8, v); }
});
def('key', 'drum', 0.15, 'f 3200 (Hz band) · decay .006 · thock .08', (o, t, p) => {
  const w = W(o, p, 0.15), s0 = S(t), f = biquad('bp', p.f ?? 3200, 2.5), dec = p.decay ?? 0.006, th = p.thock ?? 0.08, nz = noiseOf(o), n = N(o, s0, 0.035);
  for (let i = 0; i < n; i++) { const x = i / SR; w(s0 + i, f(nz()) * Math.exp(-x / dec) * 1.6 + Math.sin(TAU * 180 * x) * Math.exp(-x * 120) * th); }
});

// =============================================================== BASS
def('sub', 'tonal', 0, 'note · dur · cut 260 (Hz)', (o, t, p) => {
  const w = W(o, p, 0), s0 = S(t), f = mtof(p.note ?? 36), dur = p.dur ?? 0.25, lp = lp1(p.cut ?? 260), n = N(o, s0, dur); let ph = o.rand();
  for (let i = 0; i < n; i++) { const x = i / SR; ph += f / SR; w(s0 + i, lp(saw(ph) * 0.6 + Math.sin(TAU * ph) * 0.8) * Math.min(1, x * 200) * Math.min(1, (dur - x) * 60) * 0.42); }
});
def('sawBass', 'tonal', 0, 'note · dur · cut 900 · decay .17 (s)', (o, t, p) => {
  const w = W(o, p, 0), s0 = S(t), f = mtof(p.note ?? 36), dur = p.dur ?? 0.25, lp = lp1(p.cut ?? 900), dec = p.decay ?? 0.17, n = N(o, s0, dur); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += f / SR; w(s0 + i, lp(saw(ph)) * Math.min(1, x * 300) * Math.exp(-x / dec) * Math.min(1, (dur - x) * 200) * 0.3); }
});
def('reese', 'tonal', 0, 'note · dur · detune 12 (cents) · cut 600 · res .2', (o, t, p) => {
  const w = W(o, p, 0), s0 = S(t), f = mtof(p.note ?? 36), dur = p.dur ?? 0.5, det = p.detune ?? 12, cut = p.cut ?? 600, flt = svf(), n = N(o, s0, dur + 0.1);
  const fr = [-det, 0, det].map(c => f * Math.pow(2, c / 1200)), ph = fr.map(() => o.rand());
  for (let i = 0; i < n; i++) { const x = i / SR; let v = 0; for (let k = 0; k < 3; k++) { ph[k] += fr[k] / SR; v += saw(ph[k]); }
    w(s0 + i, flt(v / 3, cut, p.res ?? 0.2) * ahr(x, 0.008, dur, 0.04) * 0.5); }
});
def('acid', 'tonal', 0, "note · dur · cut 350 · res .85 · env 2500 (Hz) · decay .18 · accent false · from (slide start) · glide .06 (s) · wave 'saw'|'square' · drive 1.5", (o, t, p) => {
  const w = W(o, p, 0), s0 = S(t), f1 = mtof(p.note ?? 36), f0 = p.from != null ? mtof(p.from) : f1, dur = p.dur ?? 0.15, acc = p.accent ? 1.6 : 1, cut = p.cut ?? 350, env = (p.env ?? 2500) * acc, dec = p.decay ?? 0.18, flt = svf(), sq = p.wave === 'square', gl = Math.max(1e-4, p.glide ?? 0.06), n = N(o, s0, dur + 0.05); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += (f0 + (f1 - f0) * clamp(x / gl)) / SR; const fc = cut + env * Math.exp(-x / dec);
    w(s0 + i, drive(flt(sq ? sqr(ph) : saw(ph), fc, p.res ?? 0.85), p.drive ?? 1.5) * ahr(x, 0.003, dur, 0.015) * 0.28 * acc); }
});
def('wobble', 'tonal', 0, 'note · dur · div 2 (LFO cycles per beat: 1, 2, 3 = quarter-triplets) · rate (Hz, overrides div) · lo 150 · hi 2500 · res .5', (o, t, p) => {
  const w = W(o, p, 0), s0 = S(t), f = mtof(p.note ?? 36), dur = p.dur ?? 1, rate = p.rate ?? ((o.bpm || 120) / 60) * (p.div ?? 2), lo = p.lo ?? 150, hi = p.hi ?? 2500, flt = svf(), n = N(o, s0, dur + 0.05); let a = 0, b = 0.37;
  for (let i = 0; i < n; i++) { const x = i / SR; a += f / SR; b += f * 1.005 / SR; const fc = lo + (hi - lo) * (0.5 - 0.5 * Math.cos(TAU * rate * x));
    w(s0 + i, drive(flt((saw(a) + saw(b)) * 0.5, fc, p.res ?? 0.5), 1.5) * ahr(x, 0.005, dur, 0.03) * 0.3); }
});

def('upright', 'tonal', 0.12, 'note · dur · dip 25 (cents below on the attack) · decay .45 · tri .35 (triangle share) · thump .3 (finger noise)', (o, t, p) => {
  const w = W(o, p, 0.12), s0 = S(t), f = mtof(p.note ?? 40), dur = p.dur ?? 0.5, dip = p.dip ?? 25, dec = p.decay ?? 0.45, tr = p.tri ?? 0.35, th = p.thump ?? 0.3, lp = lp1(900), tl = lp1(250), nz = noiseOf(o), n = N(o, s0, dur + 0.12); let ph = o.rand();
  for (let i = 0; i < n; i++) { const x = i / SR; ph += f * Math.pow(2, -dip / 1200 * Math.exp(-x / 0.03)) / SR;
    const v = lp(Math.sin(TAU * ph) * (1 - tr) + tri(ph) * tr) * adExp(x, 0.004, dec) * Math.min(1, Math.max(0, (dur + 0.1 - x) / 0.1)) + (x < 0.02 ? tl(nz()) * th * (1 - x / 0.02) : 0);
    w(s0 + i, v * 0.55); }
});

// =============================================================== TONAL (melodic, chords)
def('pluck', 'tonal', 0.35, 'note · decay .11 · index 1.2 (FM brightness)', (o, t, p) => {
  const w = W(o, p, 0.35), s0 = S(t), f = mtof(p.note ?? 72), dec = p.decay ?? 0.11, idx = p.index ?? 1.2, n = N(o, s0, dec * 5);
  for (let i = 0; i < n; i++) { const x = i / SR; w(s0 + i, Math.sin(TAU * f * x + idx * Math.sin(TAU * f * 2 * x) * Math.exp(-x * 18)) * Math.exp(-x / dec) * 0.12); }
});
def('ks', 'tonal', 0.25, 'note|notes · decay .996 (loop feedback .990-.998) · bright .5 (pick) · mute false · dur (damp after) · strum .012 (s between strings; negative = up-strum)', (o, t, p) => {
  const ns = notesOf(p), strum = p.strum ?? 0.012, order = strum < 0 ? ns.slice().reverse() : ns;
  order.forEach((m, k) => {
    const w = W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length) }, 0.25), s0 = S(t + k * Math.abs(strum)), f = mtof(m);
    const D = SR / f - 0.5, Ni = Math.max(2, Math.floor(D - 0.1)), dl = D - Ni, C = (1 - dl) / (1 + dl);
    const buf = new Float32Array(Ni), ex = lp1(600 + (p.bright ?? 0.5) * 9000);
    for (let i = 0; i < Ni; i++) buf[i] = ex(o.rand() * 2 - 1);
    let mean = 0; for (let i = 0; i < Ni; i++) mean += buf[i]; mean /= Ni; for (let i = 0; i < Ni; i++) buf[i] -= mean;
    const fbBase = p.mute ? 0.95 : (p.decay ?? 0.996), dur = p.dur ?? 3, n = N(o, s0, Math.min(6, dur + 0.25)), damp = lp1(1200);
    let idx = 0, last = 0, ax = 0, ay = 0;
    for (let i = 0; i < n; i++) {
      const x = i / SR, y = buf[idx], fb = x > dur ? fbBase * 0.985 : fbBase;
      let avg = fb * 0.5 * (y + last); last = y;
      if (x > dur) avg = damp(avg);
      const ap = C * avg + ax - C * ay; ax = avg; ay = ap;
      buf[idx] = ap; idx = (idx + 1) % Ni;
      w(s0 + i, y * 0.5 * Math.min(1, i / 8));
    }
  });
});
def('epiano', 'tonal', 0.25, 'note|notes · dur · index 1.6 (body FM) · tine .7 · decay .6 · trem .25 (4.5 Hz stereo tremolo depth)', (o, t, p) => {
  const ns = notesOf(p), dur = p.dur ?? 0.8, idx = p.index ?? 1.6, tine = p.tine ?? 0.7, dec = p.decay ?? 0.6, trem = p.trem ?? 0.25;
  for (const m of ns) { const w = W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length) }, 0.25), s0 = S(t), f = mtof(m), n = N(o, s0, dur + 0.6), vel = p.vel ?? 1;
    for (let i = 0; i < n; i++) { const x = i / SR, I1 = (0.3 + (idx - 0.3) * Math.exp(-x / 0.4)) * (0.6 + 0.4 * vel), I2 = tine * Math.exp(-x / 0.025) * vel;
      const v = Math.sin(TAU * f * x + I1 * Math.sin(TAU * f * x) + I2 * Math.sin(TAU * 14 * f * x)) * ahr(x, 0.002, dur, 0.18) * Math.exp(-x / (dec * 3)), tr = trem * Math.sin(TAU * 4.5 * x);
      w(s0 + i, v * 0.22 * (1 - tr), v * 0.22 * (1 + tr)); } }
});
def('bell', 'tonal', 0.55, 'note|notes · ratio 3.5 (or 1.4) · index 2 · decay .36 · idecay .33 · dur 2', (o, t, p) => {
  const ns = notesOf(p), ratio = p.ratio ?? 3.5, idx = p.index ?? 2, dec = p.decay ?? 0.357, idec = p.idecay ?? 0.333, dur = p.dur ?? 2;
  for (const m of ns) { const w = W(o, p, 0.55), s0 = S(t), f = mtof(m), n = N(o, s0, Math.min(dur, dec * 9)); for (let i = 0; i < n; i++) { const x = i / SR; w(s0 + i, Math.sin(TAU * f * x + idx * Math.sin(TAU * f * ratio * x) * Math.exp(-x / idec)) * Math.exp(-x / dec) * 0.1); } }
});
def('fm', 'tonal', 0.25, 'note|notes · ratio 1 · index 2 · idecay .3 · attack .002 · decay 1 · dur .5 · release .1 · fb 0 (operator feedback)', (o, t, p) => {
  const ns = notesOf(p), ratio = p.ratio ?? 1, idx = p.index ?? 2, idec = p.idecay ?? 0.3, a = p.attack ?? 0.002, dec = p.decay ?? 1, dur = p.dur ?? 0.5, rel = p.release ?? 0.1, fb = p.fb ?? 0;
  for (const m of ns) { const w = W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length) }, 0.25), s0 = S(t), f = mtof(m), n = N(o, s0, dur + rel * 6); let mp = 0, prev = 0;
    for (let i = 0; i < n; i++) { const x = i / SR; mp += f * ratio / SR; const mod = Math.sin(TAU * mp + fb * prev); prev = mod;
      w(s0 + i, Math.sin(TAU * f * x + idx * Math.exp(-x / idec) * mod) * ahr(x, a, dur, rel) * Math.exp(-x / dec) * 0.2); } }
});
// ---- modal (additive) family: sum of exponentially decaying sines
const MODAL = {
  free: { ratios: [1, 2.756, 5.404, 8.933], amps: [1, 0.45, 0.25, 0.12], label: 'free-free bar modes (physics): glockenspiel / untuned bar' },
  tuned: { ratios: [1, 4, 10], amps: [1, 0.35, 0.12], label: 'tuned bar 1:4:10 (marimba-style undercut bars)' },
  glass: { ratios: [1, 2.32, 4.25, 6.63], amps: [1, 0.5, 0.35, 0.2], label: 'glass: starting values only, tune via spectrogram' },
  membrane: { ratios: [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156], amps: [1, 0.7, 0.55, 0.45, 0.35, 0.3, 0.25], label: 'ideal circular membrane modes (physics): drum-like, gong-like with long decay' },
  wood: { ratios: [1, 2.756, 5.404, 8.933], amps: [1, 0.5, 0.3, 0.15], decay: 0.08, noise: 0.25, label: 'wood = free-bar modes with short decays (30-120 ms)' },
  ceramic: { ratios: [1, 2.42, 4.07], amps: [1, 0.6, 0.35], decay: 0.35, noise: 0.35, label: 'ceramic: 3 partials, medium decay, sharp click (starting values)' },
};
// ---- object shapes (physics): mode ratios from the SHAPE of an object in the product's world, so a found sound
// (M26) starts from what the object is instead of from a stock drum renamed (music-synthesis.md §7, found-sound
// recipes). Ideal shapes: a real object is neither ideal nor simply supported, so these are starting values; tune
// them against a recording of the object when the user supplies one. Ratio 1 = the lowest mode = the note (or f).
const SHAPES = ['plate', 'ring', 'tube'];
function shapeModes(p) {
  const want = p.modes;
  if (p.shape === 'plate') {
    // thin rectangular plate, simply supported (Kirchhoff): f_mn ~ (m/a)^2 + (n/b)^2, aspect = long side / short side.
    // A point strike at (u, v), as fractions of the two sides, drives mode mn by sin(m pi u) sin(n pi v): a strike on
    // a nodal line leaves that mode out (a centre strike silences every mode with an even m or n), so WHERE the
    // object is hit is part of its timbre. amps also fall as r^-0.5 (practice: a finite striker, weaker radiation).
    const A = Math.max(1, Number(p.aspect) || 1.5), [u, v] = Array.isArray(p.strike) ? p.strike : [0.31, 0.37];
    const f11 = 1 / (A * A) + 1, all = [];
    for (let m = 1; m <= 9; m++) for (let n = 1; n <= 9; n++) all.push({ r: (m * m / (A * A) + n * n) / f11, a: Math.abs(Math.sin(m * Math.PI * u) * Math.sin(n * Math.PI * v)) });
    all.sort((x, y) => x.r - y.r);
    const a0 = all[0].a || 1, keep = all.slice(0, want ?? 10).map(q => ({ r: q.r, a: q.a / a0 / Math.sqrt(q.r) })).filter(q => q.a >= 0.02);
    return { ratios: keep.map(q => +q.r.toFixed(4)), amps: keep.map(q => +q.a.toFixed(3)) };
  }
  if (p.shape === 'ring') {
    // thin circular ring or shell rim (a cup, glass, can, bowl, bottle body): inextensional bending modes n = 2, 3 ...
    // at f_n ~ n(n^2 - 1)/sqrt(n^2 + 1) (Rayleigh): 1 : 2.83 : 5.42 : 8.77 : 12.86, the "wine glass" series
    const ns = Array.from({ length: want ?? 5 }, (_, k) => k + 2), g = n => n * (n * n - 1) / Math.sqrt(n * n + 1);
    return { ratios: ns.map(n => +(g(n) / g(2)).toFixed(4)), amps: ns.map((_, k) => [1, 0.6, 0.35, 0.2, 0.12, 0.08, 0.05][Math.min(k, 6)]) };
  }
  if (p.shape === 'tube') {
    // air column: closed at one end (a bottle, a cup, a capped tube) = odd harmonics 1:3:5:7; open at both ends
    // (a pipe, a straw, a card tube) = 1:2:3:4 (physics). The pitch comes from the length: tubeHz().
    const open = p.ends === 'open', ks = Array.from({ length: want ?? 5 }, (_, k) => (open ? k + 1 : 2 * k + 1));
    return { ratios: ks, amps: ks.map(k => +(1 / k).toFixed(3)) };
  }
  throw new Error(`shape '${p.shape}' unknown: ${SHAPES.join(' | ')}`);
}
/** Approximate handbook values (E Pa, rho kg/m^3, nu) for plateHz; real stock varies by about 30 %. tau = a starting
 *  decay (s) for the fundamental of a struck panel of that material (practice: metal rings, plastic and card thud). */
export const OBJECT_MATERIALS = {
  steel: { E: 200e9, rho: 7850, nu: 0.29, tau: 0.9 }, aluminium: { E: 69e9, rho: 2700, nu: 0.33, tau: 0.6 },
  glass: { E: 70e9, rho: 2500, nu: 0.22, tau: 0.35 }, acrylic: { E: 3.2e9, rho: 1190, nu: 0.37, tau: 0.04 },
  abs: { E: 2.3e9, rho: 1050, nu: 0.35, tau: 0.03 }, plywood: { E: 9e9, rho: 600, nu: 0.3, tau: 0.05 },
  card: { E: 4e9, rho: 700, nu: 0.3, tau: 0.015 },
};
/** Lowest mode (Hz) of a thin simply supported plate a x b x h metres:
 *  f11 = (pi/2) h sqrt(E / (12 rho (1 - nu^2))) (1/a^2 + 1/b^2)  (Kirchhoff, physics). material: an OBJECT_MATERIALS
 *  name or { E, rho, nu }. A free object (lying on a table, held loosely) rings somewhat differently: a start, not a fact. */
export function plateHz({ a, b, h, material = 'aluminium' }) {
  const m = typeof material === 'string' ? OBJECT_MATERIALS[material] : material;
  if (!m) throw new Error(`plateHz: material '${material}' unknown (${Object.keys(OBJECT_MATERIALS).join(', ')}) or { E, rho, nu }`);
  if (!(a > 0 && b > 0 && h > 0)) throw new Error('plateHz: a, b and h are the plate sides and thickness in metres');
  return (Math.PI / 2) * h * Math.sqrt(m.E / (12 * m.rho * (1 - m.nu * m.nu))) * (1 / (a * a) + 1 / (b * b));
}
/** Lowest resonance (Hz) of an air column L metres long, radius r: closed at one end c / 4(L + 0.61 r), open at both
 *  c / 2(L + 1.22 r), c = 343 m/s at 20 C (physics; 0.61 r = the end correction of an unflanged open end). */
export function tubeHz({ L, r = 0, ends = 'closed' }) {
  if (!(L > 0)) throw new Error('tubeHz: L is the air column length in metres');
  return ends === 'open' ? 343 / (2 * (L + 1.22 * r)) : 343 / (4 * (L + 0.61 * r));
}
/** ratios: a MODAL preset name ('free', 'tuned', 'glass', ...) or an array of frequency ratios (1 = the note).
 *  A name brings that preset's amplitudes too, unless amps is given. shape ('plate' | 'ring' | 'tube') derives
 *  them from the object instead; explicit ratios win over shape, shape over material. */
function modalRatios(p, pr) {
  const r = p.ratios;
  if (r == null && p.shape != null) { const s = shapeModes(p); return { ratios: s.ratios, amps: p.amps ?? s.amps }; }
  if (r == null) return { ratios: pr.ratios, amps: p.amps ?? pr.amps };
  if (typeof r === 'string') {
    const q = MODAL[r]; if (!q) throw new Error(`ratios '${r}' unknown: a preset name (${Object.keys(MODAL).join(', ')}) or an array such as [1, 2.756, 5.404]`);
    return { ratios: q.ratios, amps: p.amps ?? q.amps };
  }
  if (Array.isArray(r) && r.length && r.every(x => typeof x === 'number' && x > 0)) return { ratios: r, amps: p.amps };
  throw new Error(`ratios must be a preset name (${Object.keys(MODAL).join(', ')}) or an array of positive numbers, got ${JSON.stringify(r)}`);
}
function modalPlay(o, t, p, preset, defSend, gain0) {
  if (p.material != null && !MODAL[p.material]) throw new Error(`material '${p.material}' unknown: ${Object.keys(MODAL).join(' | ')} (steel, glass, abs ... are plateHz materials; for an object's shape use shape: ${SHAPES.join(' | ')})`);
  const pr = MODAL[p.material ?? preset] ?? MODAL[preset], mr = modalRatios(p, pr), ratios = mr.ratios, amps = mr.amps ?? ratios.map((_, k) => 1 / (k + 1));
  const ns = notesOf(p), tau1 = p.decay ?? pr.decay ?? 1.2, tilt = p.tilt ?? 0.9, nzA = p.noise ?? pr.noise ?? 0.08, hard = p.hard ?? 0.5, nz = noiseOf(o);
  for (const m of ns) {
    const w = W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length) }, defSend), s0 = S(t), f = p.f ?? mtof(m);
    const parts = ratios.map((r, k) => ({ osc: sinOsc(f * r, 0), a: amps[k] ?? 0.1, tau: (p.decays?.[k]) ?? tau1 / Math.pow(r, tilt) }))
      .filter((q, k) => q.a > 0 && f * ratios[k] < SR * 0.45);        // drop partials above ~Nyquist
    if (!parts.length) continue;
    const longest = Math.max(...parts.map(q => q.tau)), n = N(o, s0, longest * 5 + 0.01), b = biquad('bp', 1500 + hard * 4000, 1.2), att = p.attack ?? 0.0008;
    const dk = parts.map(q => Math.exp(-1 / (q.tau * SR))), env = parts.map(() => 1);
    for (let i = 0; i < n; i++) { const x = i / SR; let v = 0;
      for (let k = 0; k < parts.length; k++) { v += parts[k].osc() * parts[k].a * env[k]; env[k] *= dk[k]; }
      if (x < 0.006) v += b(nz()) * nzA * (1 - x / 0.006) * 3;
      w(s0 + i, v * gain0 * Math.min(1, x / att)); }
  }
}
def('bar', 'tonal', 0.35, "note|notes · ratios 'free' (default: 1:2.756:5.404:8.933 free-free bar, physics) | 'tuned' (1:4:10 marimba-style; tuned: true says the same) | any modal material name | [1, r2, r3 ...] · amps [] · decay 1.2 · tilt .9 (upper partials decay faster) · hard .5 (mallet) · noise .08", (o, t, p) => modalPlay(o, t, p.tuned ? { ...p, material: 'tuned' } : p, 'free', 0.35, 0.22));
def('glass', 'tonal', 0.5, 'note|notes · decay 1.2 · ratios [1,2.32,4.25,6.63] (starting values, tune by spectrogram; or a preset name) · noise .03 · attack .003', (o, t, p) => modalPlay(o, t, { attack: 0.003, noise: 0.03, ...p }, 'glass', 0.5, 0.2));
def('membrane', 'drum', 0.3, 'note|notes · decay .5 (long = gong-like) · ratios: ideal circular membrane 1:1.594:2.136:2.296:2.653:2.918:3.156 (physics; or a preset name / array) · noise .2', (o, t, p) => modalPlay(o, t, { decay: 0.5, noise: 0.2, tilt: 0.3, ...p }, 'membrane', 0.3, 0.2));
def('modal', 'tonal', 0.3, "note|notes · f (Hz, overrides note) · material 'free'|'tuned'|'glass'|'membrane'|'wood'|'ceramic' · shape (an object's modes, physics): 'plate' (aspect 1.5 = long/short side, strike [.31,.37] = where it is hit) | 'ring' (cup, glass, can rim) | 'tube' (air column, ends 'closed'|'open') · modes (count) · ratios (preset name or []; wins over shape) · amps [] · decays [] (s per partial) · decay · tilt · noise · hard · attack. Pitch from size: plateHz, tubeHz in tools/audio/instruments.mjs",(o, t, p) => modalPlay(o, t, p, p.material ?? 'free', 0.3, 0.22));
def('wood', 'drum', 0.15, 'note · decay .08 (free-bar modes, short) · hard .6', (o, t, p) => modalPlay(o, t, { hard: 0.6, ...p, material: 'wood' }, 'wood', 0.15, 0.3));
def('ceramic', 'foley', 0.25, 'note · decay .35 · noise .35', (o, t, p) => modalPlay(o, t, { ...p, material: 'ceramic' }, 'ceramic', 0.25, 0.25));
// ---- physical-model gestures over the modal body (found-sound recipes, music-synthesis.md §7)
// rattle: an object dropped onto a surface settles in bounces. Each rebound leaves at e x the impact speed
// (coefficient of restitution), so each flight time and each impact's loudness shrink by e (physics); the train
// lasts first / (1 - e). Each impact rings the object's own modes (note | f, shape | material | ratios), darker as it
// slows (hard x sqrt(speed), practice). jitter scatters the gaps: an irregular object tumbles, a ball does not.
def('rattle', 'foley', 0.2, "e .55 (restitution: each gap and impact = e x the last, physics) · first .09 (s, first gap) · n 8 (impacts) · jitter .15 · the object it rings: note | f · shape 'plate'|'ring'|'tube' (+ aspect strike ends) | material | ratios · decay .05 · hard .7 (first impact)", (o, t, p) => {
  const e = clamp(p.e ?? 0.55, 0.05, 0.95), nb = Math.max(1, Math.round(p.n ?? 8)), jit = clamp(p.jitter ?? 0.15, 0, 0.9), hard = p.hard ?? 0.7;
  let tt = t, gap = p.first ?? 0.09, v = 1;
  for (let k = 0; k < nb; k++) {
    modalPlay(o, tt, { decay: 0.05, noise: 0.3, ...p, vel: (p.vel ?? 1) * v, hard: hard * Math.sqrt(v) }, 'wood', 0.2, 0.25);
    tt += gap * (1 + jit * (o.rand() * 2 - 1)); gap *= e; v *= e;
  }
});
// scrape: friction or detents as a click train. A nail drawn over ridges, a zip, a ratchet, a scroll wheel or a coin
// edge clicks at (speed / ridge spacing) per second (physics): periodic clicks are heard as a pitch at that rate, a
// rising speed as a rising buzz, random ones (jitter 1) as crinkle. Each click rings the body's modes briefly (a bank
// of damped resonators at f x ratios) plus a high-passed contact tick. rate0 -> rate1 is linear over dur.
def('scrape', 'foley', 0.15, "dur .5 · rate0 120 · rate1 (= rate0) (clicks/s = speed / ridge spacing, physics) or v0 · v1 (m/s) with spacing (m) · jitter .15 (0 = periodic, heard as a pitch; 1 = random, crinkle) · the body each click rings: note | f (2400 Hz) · shape | material | ratios · decay .004 (s) · tilt .5 · noise .4 (contact tick)", (o, t, p) => {
  const d = p.dur ?? 0.5, sp = p.spacing, r0 = p.v0 != null && sp > 0 ? p.v0 / sp : p.rate0 ?? 120, r1 = p.v1 != null && sp > 0 ? p.v1 / sp : p.rate1 ?? r0;
  if (p.material != null && !MODAL[p.material]) throw new Error(`material '${p.material}' unknown: ${Object.keys(MODAL).join(' | ')}, or shape: ${SHAPES.join(' | ')}`);
  const jit = clamp(p.jitter ?? 0.15, 0, 1), mr = modalRatios(p, MODAL[p.material ?? 'free']), f = p.f ?? (p.note != null ? mtof(p.note) : 2400);
  const tau = p.decay ?? 0.004, tilt = p.tilt ?? 0.5, nzA = p.noise ?? 0.4, nz = noiseOf(o), hp = hp1(3000), w = W(o, p, 0.15), s0 = S(t);
  const n = N(o, s0, d + tau * 8), nn = Math.max(1, Math.round(d * SR)), F = Math.min(240, nn >> 2);
  const res = mr.ratios.map((r, k) => ({ c: Math.cos(TAU * f * r / SR), s: Math.sin(TAU * f * r / SR), a: mr.amps?.[k] ?? 1 / (k + 1), g: Math.exp(-1 / ((tau / Math.pow(r, tilt)) * SR)), re: 0, im: 0 }))
    .filter((q, k) => f * mr.ratios[k] < SR * 0.45);
  let ph = 0, next = 1, burst = 0, amp = 0;
  for (let i = 0; i < n; i++) {
    let x = 0, grit = 0;
    if (i < nn) {
      ph += (r0 + (r1 - r0) * (i / nn)) / SR;
      if (ph >= next) { ph -= next; next = 1 + 0.9 * jit * (o.rand() * 2 - 1); amp = Math.min(1, i / F, (nn - i) / F) * (1 - 0.5 * jit * o.rand()); x = amp; burst = 24; }
    }
    if (burst > 0) { grit = nz() * amp * (burst / 24); burst--; }
    let v = 0;
    for (const q of res) { const re = q.g * (q.re * q.c - q.im * q.s) + x + 0.3 * grit, im = q.g * (q.re * q.s + q.im * q.c); q.re = re; q.im = im; v += im * q.a; }
    w(s0 + i, (v * 0.25 + hp(grit) * nzA) * 0.5);
  }
});
def('piano', 'tonal', 0.25, 'note|notes · dur · B .00025 (string inharmonicity) · decay (auto by pitch) · partials 10 · felt false (soft, dark, slow attack) · hammer .3', (o, t, p) => {
  const ns = notesOf(p), dur = p.dur ?? 1.2, B = p.B ?? 0.00025, np = p.partials ?? 10, felt = !!p.felt, vel = p.vel ?? 0.8, ham = p.hammer ?? 0.3, nz = noiseOf(o);
  for (const m of ns) {
    const w = W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length), pan: p.pan ?? clamp((m - 60) / 50, -0.35, 0.35) }, 0.25), s0 = S(t), f = mtof(m);
    const tau1 = p.decay ?? clamp(3.2 * Math.sqrt(261.6 / f), 0.5, 7), parts = [];
    for (let k = 1; k <= np; k++) { const fk = k * f * Math.sqrt(1 + B * k * k); if (fk > SR * 0.45) break;
      const a = Math.pow(k, -1.1) * Math.exp(-(k - 1) * (felt ? 0.55 : 0.38 - 0.22 * vel));
      for (const c of [-0.8, 0.8]) parts.push({ osc: sinOsc(fk * Math.pow(2, c / 1200), o.rand() * TAU), a: a * 0.5, tau: tau1 / Math.pow(k, 0.7) }); }
    const n = N(o, s0, Math.min(dur + 1.5, tau1 * 4)), flt = felt ? svf() : null, lp = lp1(3000), thock = lp1(200), att = felt ? 0.006 : 0.001;
    for (let i = 0; i < n; i++) { const x = i / SR; let v = 0; for (const q of parts) v += q.osc() * q.a * Math.exp(-x / q.tau);
      if (x < 0.005) v += lp(nz()) * ham * (1 - x / 0.005);
      if (felt) { v = flt(v, 2200, 0); if (x < 0.03) v += thock(nz()) * 0.6 * (1 - x / 0.03); }
      const rel = x > dur ? Math.exp(-(x - dur) / 0.12) : 1;
      w(s0 + i, v * rel * Math.min(1, x / att) * 0.3); }
  }
});
def('organ', 'tonal', 0.3, "note|notes · dur · drawbars [.5,1,.6,.4,.25,.15] (x .5 1 1.5 2 3 4) · leslie 'slow'|'fast'|0 · click .15", (o, t, p) => {
  const ns = notesOf(p), dur = p.dur ?? 1, mul = [0.5, 1, 1.5, 2, 3, 4], dbs = p.drawbars ?? [0.5, 1, 0.6, 0.4, 0.25, 0.15], lr = p.leslie === 'fast' ? 6.7 : p.leslie === 'slow' ? 0.8 : 0, ck = p.click ?? 0.15, nz = noiseOf(o);
  for (const m of ns) { const w = W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length) }, 0.3), s0 = S(t), f = mtof(m), n = N(o, s0, dur + 0.1), ph = mul.map(() => o.rand());
    for (let i = 0; i < n; i++) { const x = i / SR, vib = lr ? 1 + 0.003 * Math.sin(TAU * lr * x) : 1; let v = 0;
      for (let k = 0; k < 6; k++) { ph[k] += f * mul[k] * vib / SR; if (dbs[k]) v += Math.sin(TAU * ph[k]) * dbs[k]; }
      v = v * 0.09 * ahr(x, 0.006, dur, 0.04) + (x < 0.002 ? nz() * ck : 0); const am = lr ? 0.22 * Math.sin(TAU * lr * x) : 0;
      w(s0 + i, v * (1 - am), v * (1 + am)); } }
});
def('supersaw', 'tonal', 0.35, 'note|notes · dur · spread 1 (x cents 0 +-6 +-12 +-20) · cut 6000 · hp 150 · attack .01 · release .15', (o, t, p) => {
  const ns = notesOf(p), dur = p.dur ?? 0.5, sp = p.spread ?? 1, cents = [0, -6, 6, -12, 12, -20, 20].map(c => c * sp), cut = p.cut ?? 6000;
  for (const m of ns) { const w = W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length) }, 0.35), s0 = S(t), f = mtof(m), n = N(o, s0, dur + (p.release ?? 0.15) * 6), ph = cents.map(() => o.rand());
    const fl = svf(), fr = svf(), hl = hp1(p.hp ?? 150), hr = hp1(p.hp ?? 150), fq = cents.map(c => f * Math.pow(2, c / 1200));
    for (let i = 0; i < n; i++) { const x = i / SR; let l = 0, r = 0;
      for (let k = 0; k < 7; k++) { ph[k] += fq[k] / SR; const s = saw(ph[k]); if (k === 0) { l += s; r += s; } else if (k % 2) l += s * 1.3; else r += s * 1.3; }
      const e = ahr(x, p.attack ?? 0.01, dur, p.release ?? 0.15) * 0.06; w(s0 + i, hl(fl(l, cut)) * e, hr(fr(r, cut)) * e); } }
});
def('pad', 'tonal', 0.55, 'notes · dur · cut 900 · cutEnd (sweep target) · res .1 · detune 10 (cents) · attack .4 · release .6 · lfo .25 (Hz) · lfoDepth .2 · chorus .5', (o, t, p) => {
  const ns = notesOf(p), dur = p.dur ?? 2, det = p.detune ?? 10, cut0 = p.cut ?? 900, cut1 = p.cutEnd ?? cut0, a = p.attack ?? 0.4, rel = p.release ?? 0.6, lfo = p.lfo ?? 0.25, ld = p.lfoDepth ?? 0.2, ch = p.chorus ?? 0.5;
  const w = W(o, p, 0.55), s0 = S(t), n = N(o, s0, dur + rel * 5), osc = []; for (const m of ns) for (const c of [-det, det]) osc.push({ f: mtof(m) * Math.pow(2, c / 1200), ph: o.rand(), side: c < 0 ? 0 : 1 });
  const fl = svf(), fr = svf(), dn = 2048, dlL = new Float32Array(dn), dlR = new Float32Array(dn), g = 0.16 / Math.sqrt(osc.length), lph = o.rand() * TAU;
  for (let i = 0; i < n; i++) { const x = i / SR; let l = 0, r = 0;
    for (const q of osc) { q.ph += q.f / SR; const s = saw(q.ph); if (q.side) r += s; else l += s; }
    const fc = (cut0 + (cut1 - cut0) * clamp(x / Math.max(0.01, dur))) * (1 + ld * Math.sin(TAU * lfo * x + lph));
    let L = fl(l, fc, p.res ?? 0.1), R = fr(r, fc, p.res ?? 0.1);
    if (ch) { const wi = i % dn; dlL[wi] = L; dlR[wi] = R; const dL = (0.02 + 0.002 * Math.sin(TAU * 0.5 * x)) * SR, dR = (0.02 + 0.002 * Math.cos(TAU * 0.5 * x)) * SR;
      const rd = (buf, d) => { const pos = wi - d, i0 = Math.floor(pos), fr2 = pos - i0; return buf[((i0 % dn) + dn) % dn] * (1 - fr2) + buf[(((i0 + 1) % dn) + dn) % dn] * fr2; };
      L = L * (1 - ch * 0.5) + rd(dlL, dL) * ch * 0.5; R = R * (1 - ch * 0.5) + rd(dlR, dR) * ch * 0.5; }
    const e = ahr(x, a, dur, rel) * g; w(s0 + i, L * e, R * e); }
});
def('stab', 'tonal', 0.35, 'notes · dur .4 · bright 3500 (Hz LP) · decay (relative, 7/dur)', (o, t, p) => {
  const ns = notesOf(p), dur = p.dur ?? 0.4, a = lp1(p.bright ?? 3500), b = lp1(p.bright ?? 3500), ph = ns.map(() => [o.rand(), o.rand()]), w = W(o, p, 0.35), s0 = S(t), n = N(o, s0, dur), k7 = p.decay ?? 7;
  for (let i = 0; i < n; i++) { const x = i / SR; let l = 0, r = 0; ns.forEach((m, k) => { ph[k][0] += mtof(m - 0.1) / SR; ph[k][1] += mtof(m + 0.1) / SR; l += saw(ph[k][0]); r += saw(ph[k][1]); });
    const env = Math.min(1, x * 300) * Math.exp(-x * k7 / dur) * 0.055 * Math.min(1, (dur - x) * 200); w(s0 + i, a(l) * env, b(r) * env); }
});
def('arpSaw', 'tonal', 0.4, 'note · cut 2600 · decay .07', (o, t, p) => {
  const w = W(o, p, 0.4), s0 = S(t), f = mtof(p.note ?? 72), lp = lp1(p.cut ?? 2600), dec = p.decay ?? 0.07, n = N(o, s0, Math.max(0.18, dec * 3)); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += f / SR; w(s0 + i, lp(saw(ph)) * Math.exp(-x / dec) * 0.09); }
});
def('brass', 'tonal', 0.4, 'note|notes · dur · attack .05 (filter opening) · bright 3500 (Hz added at vel 1) · scoop 30 (cents below) · drive 1.2', (o, t, p) => {
  const ns = notesOf(p), dur = p.dur ?? 0.6, att = p.attack ?? 0.05, vel = p.vel ?? 0.8, br = p.bright ?? 3500, sc = p.scoop ?? 30;
  for (const m of ns) { const w = W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length) }, 0.4), s0 = S(t), f = mtof(m), n = N(o, s0, dur + 0.3), flt = svf(); let ph = o.rand(), ph2 = o.rand();
    for (let i = 0; i < n; i++) { const x = i / SR, fx = f * Math.pow(2, -sc / 1200 * Math.exp(-x / 0.02)); ph += fx / SR; ph2 += fx * 1.003 / SR;
      const fc = 300 + br * vel * clamp(x / att) * (0.75 + 0.25 * Math.exp(-x / 0.4)); w(s0 + i, drive(flt((saw(ph) + saw(ph2)) * 0.5, fc, 0.15), p.drive ?? 1.2) * ahr(x, 0.02, dur, 0.06) * 0.2); } }
});
def('braam', 'tonal', 0.7, 'note (root, ~A1-D2) · dur 4 · open .15 (s, LP 200->2500) · drive 2.5 · sub .5 -- famously overused (cliche C23): once at most, with a reason', (o, t, p) => {
  const w = W(o, p, 0.7), s0 = S(t), root = p.note ?? 33, dur = p.dur ?? 4, op = p.open ?? 0.15, dr = p.drive ?? 2.5, sub = p.sub ?? 0.5, n = N(o, s0, dur + 1);
  const stack = [root, root - 12, root + 7, root + 12].flatMap(m => [-8, 8].map(c => ({ f: mtof(m) * Math.pow(2, c / 1200), ph: o.rand() }))), fl = svf(), fr = svf(), fs = mtof(root - 12);
  for (let i = 0; i < n; i++) { const x = i / SR; let l = 0, r = 0; stack.forEach((q, k) => { q.ph += q.f / SR; const s = saw(q.ph); if (k % 2) r += s; else l += s; });
    const fc = 200 + 2300 * clamp(x / op) * Math.exp(-Math.max(0, x - op) / (dur * 0.6)), e = ahr(x, 0.03, dur, 0.4) * 0.16;
    const sb = Math.sin(TAU * fs * x) * sub * ahr(x, 0.01, dur, 0.4) * 0.6;
    w(s0 + i, drive(fl(l / 4, fc, 0.2), dr) * e + sb, drive(fr(r / 4, fc, 0.2), dr) * e + sb); }
});
// formant voice. Peterson & Barney (1952) adult male averages; a/i/u as cited in 03 [S68].
export const VOWELS = { a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010], o: [570, 840, 2410], u: [300, 870, 2240] };
function voxNote(o, t, p, m, w, detCents = 0, vibPh = 0) {
  const s0 = S(t), dur = p.dur ?? 0.5, f = mtof(m) * Math.pow(2, detCents / 1200), v0 = VOWELS[p.vowel ?? 'a'] ?? VOWELS.a, v1 = VOWELS[p.vowelTo ?? p.vowel ?? 'a'] ?? v0, sh = p.shift ?? 1;
  const bands = [0, 1, 2].map(() => svf()), gains = [1, 0.55, 0.3], vib = p.vib ?? 30, br = p.breath ?? 0.05, n = N(o, s0, dur + (p.release ?? 0.08) * 5), nz = noiseOf(o), bend = p.bend ?? 0;
  let ph = o.rand();
  for (let i = 0; i < n; i++) { const x = i / SR, k = clamp(x / Math.max(0.01, dur)), vb = vib * clamp((x - 0.15) / 0.2) * Math.sin(TAU * 5.5 * x + vibPh);
    const fx = f * Math.pow(2, (vb + bend * 100 * Math.max(0, (x - dur * 0.7) / (dur * 0.3))) / 1200); ph += fx / SR;
    const src = (p.source === 'pulse' ? pulse(ph, 0.3) : saw(ph)) + nz() * br; let v = 0;
    for (let b = 0; b < 3; b++) { bands[b](src, (v0[b] + (v1[b] - v0[b]) * k) * sh, 0.9); v += bands[b].bp * gains[b]; }
    w(s0 + i, v * ahr(x, p.attack ?? 0.03, dur, p.release ?? 0.08) * 0.16); }
}
def('vox', 'tonal', 0.35, "note|notes · dur · vowel 'a'|'e'|'i'|'o'|'u' · vowelTo (glide) · shift 1 (formant scale; 1.15-1.2 female/child) · vib 30 (cents) · breath .05 · bend 0 (semitones down at the end) · source 'saw'|'pulse'", (o, t, p) => {
  const ns = notesOf(p); for (const m of ns) voxNote(o, t, p, m, W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length) }, 0.35));
});
def('choir', 'tonal', 0.6, 'notes · dur · voices 6 (per note, detuned +-10 cents) · vowel · vowelTo · shift · attack .25 · release .5', (o, t, p) => {
  const ns = notesOf(p), nv = p.voices ?? 6, q = { attack: 0.25, release: 0.5, breath: 0.08, ...p };
  for (const m of ns) for (let k = 0; k < nv; k++) voxNote(o, t, q, m, W(o, { ...q, gain: (p.gain ?? 1) / Math.sqrt(ns.length * nv) * 0.9, pan: (p.pan ?? 0) + (k / Math.max(1, nv - 1) - 0.5) * 0.8 }, 0.6), (o.rand() * 2 - 1) * 10, o.rand() * TAU);
});
// glide: from (MIDI) or slide (semitones from the note) -> the note over `glide` s, linear in pitch. stepHz quantises
// the slide into steps per second (60 = a console sound driver updating pitch once per video frame, the stepped
// chip slide); 0 = smooth. A pull across a span = one long note: { dur: span, slide: -12, glide: span }.
def('pulse', 'tonal', 0.15, 'note|notes · dur · duty .25 (.125 .25 .5) · arp [] (semitone offsets cycled, fake chords) · arpRate 60 (Hz) · vib 15 (cents, after .2 s) · decay 0 (0 = hold) · steps16 true (volume quantised to 16 levels) · from (MIDI glide start) or slide (semitones from the note, - = from below) · glide .06 (s) · stepHz 0 (60 = frame-stepped slide)', (o, t, p) => {
  const ns = notesOf(p), dur = p.dur ?? 0.25, duty = p.duty ?? 0.25, arp = p.arp ?? [], ar = p.arpRate ?? 60, vib = p.vib ?? 15, dec = p.decay ?? 0, q16 = p.steps16 ?? true;
  const gl = Math.max(1e-4, p.glide ?? 0.06), sh = p.stepHz ?? 0;
  for (const m of ns) { const w = W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length) }, 0.15), s0 = S(t), n = N(o, s0, dur + 0.02); let ph = 0;
    const from = p.from != null ? m + (p.from - (p.note ?? ns[0])) : p.slide ? m + p.slide : m;   // a chord slides as one shape
    for (let i = 0; i < n; i++) { const x = i / SR, off = arp.length ? arp[Math.floor(x * ar) % arp.length] : 0, vb = x > 0.2 ? vib * Math.sin(TAU * 6 * x) : 0;
      const xs = sh > 0 ? Math.floor(x * sh) / sh : x, pm = from === m ? m : from + (m - from) * clamp(xs / gl);
      ph += mtof(pm + off + vb / 100) / SR; let e = Math.min(1, (dur + 0.02 - x) * 100) * (dec ? Math.exp(-x / dec) : 1); if (q16) e = Math.round(e * 15) / 15;
      w(s0 + i, pulse(ph, duty) * e * 0.12); } }
});
def('triangle', 'tonal', 0.05, 'note · dur (4-bit quantised triangle, chip bass)', (o, t, p) => {
  const w = W(o, p, 0.05), s0 = S(t), f = mtof(p.note ?? 45), dur = p.dur ?? 0.25, n = N(o, s0, dur); let ph = 0;
  for (let i = 0; i < n; i++) { ph += f / SR; w(s0 + i, Math.round(tri(ph) * 7.5) / 7.5 * 0.35 * Math.min(1, (dur - i / SR) * 300)); }
});
def('blip', 'tonal', 0.3, 'note · dur .13 · decay .045', (o, t, p) => {
  const w = W(o, p, 0.3), s0 = S(t), f = mtof(p.note ?? 76), dur = p.dur ?? 0.13, dec = p.decay ?? 0.045, lp = lp1(5000), n = N(o, s0, dur); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += f * (1 + 0.5 * Math.exp(-x * 60)) / SR; w(s0 + i, lp(sqr(ph) * 0.5 + Math.sin(TAU * ph) * 0.5) * Math.exp(-x / dec) * 0.12); }
});
def('sine', 'tonal', 0.3, 'note|notes · dur · attack .005 · release .1 · decay 0 (0 = hold)', (o, t, p) => {
  const ns = notesOf(p), dur = p.dur ?? 0.3, a = p.attack ?? 0.005, rel = p.release ?? 0.1, dec = p.decay ?? 0;
  for (const m of ns) { const w = W(o, { ...p, gain: (p.gain ?? 1) / Math.sqrt(ns.length) }, 0.3), s0 = S(t), osc = sinOsc(mtof(m)), n = N(o, s0, dur + rel * 6);
    for (let i = 0; i < n; i++) { const x = i / SR; w(s0 + i, osc() * ahr(x, a, dur, rel) * (dec ? Math.exp(-x / dec) : 1) * 0.25); } }
});
def('drone', 'texture', 0.6, 'notes · dur · cutLo 250 · cutHi 1400 · wander .07 (Hz) · attack 1.5 · release 2', (o, t, p) => {
  const ns = notesOf(p), dur = p.dur ?? 4, w = W(o, p, 0.6), s0 = S(t), rel = p.release ?? 2, n = N(o, s0, dur + rel * 4), lo = p.cutLo ?? 250, hi = p.cutHi ?? 1400, wr = p.wander ?? 0.07;
  const osc = []; for (const m of ns) for (const c of [-7, 0, 7]) osc.push({ f: mtof(m) * Math.pow(2, c / 1200), ph: o.rand(), s: osc.length % 2 });
  const fl = svf(), fr = svf(), g = 0.2 / Math.sqrt(osc.length), p1 = o.rand() * TAU;
  for (let i = 0; i < n; i++) { const x = i / SR; let l = 0, r = 0; for (const q of osc) { q.ph += q.f / SR; const s = saw(q.ph); if (q.s) r += s; else l += s; }
    const fc = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(TAU * wr * x + p1)), e = ahr(x, p.attack ?? 1.5, dur, rel) * g; w(s0 + i, fl(l, fc, 0.2) * e, fr(r, fc * 1.03, 0.2) * e); }
});

// =============================================================== TEXTURES (long notes, usually `hold`)
def('vinyl', 'texture', 0, 'dur · rate 12 (crackles/s) · hiss .006 · pops .5', (o, t, p) => {
  const w = W(o, p, 0), s0 = S(t), dur = p.dur ?? 4, n = N(o, s0, dur), rate = p.rate ?? 12, hs = p.hiss ?? 0.006, pops = p.pops ?? 0.5, h = hp1(1000), lp = lp1(6000), nz = noiseOf(o); let imp = 0;
  for (let i = 0; i < n; i++) { if (o.rand() < rate / SR) imp = (o.rand() * 0.7 + 0.3) * pops * (o.rand() < 0.5 ? -1 : 1); const v = h(imp) + lp(nz()) * hs; imp *= 0.6;
    w(s0 + i, v * Math.min(1, i / 2400, (n - i) / 2400)); }
});
def('hiss', 'texture', 0, 'dur · level .01 · tone 6000', (o, t, p) => {
  const w = W(o, p, 0), s0 = S(t), n = N(o, s0, p.dur ?? 4), lp = lp1(p.tone ?? 6000), lv = p.level ?? 0.01, nz = noiseOf(o), m = 2400;
  for (let i = 0; i < n; i++) w(s0 + i, lp(nz()) * lv * Math.min(1, i / m, (n - i) / m));
});
def('wind', 'texture', 0.3, 'dur · lo 300 · hi 1200 (Hz, wandering band) · gust .15 (Hz) · level .4', (o, t, p) => {
  const w = W(o, p, 0.3), s0 = S(t), n = N(o, s0, p.dur ?? 4), fl = svf(), fr = svf(), lo = p.lo ?? 300, hi = p.hi ?? 1200, gs = p.gust ?? 0.15, lv = p.level ?? 0.4, nz = noiseOf(o), a = o.rand() * TAU, b = o.rand() * TAU, m = SR;
  for (let i = 0; i < n; i++) { const x = i / SR, k = 0.5 + 0.3 * Math.sin(TAU * gs * x + a) + 0.2 * Math.sin(TAU * gs * 2.3 * x + b), fc = lo + (hi - lo) * k;
    fl(nz(), fc, 0.6); fr(nz(), fc * 1.1, 0.6); const e = lv * (0.4 + 0.6 * k) * Math.min(1, i / m, (n - i) / m); w(s0 + i, fl.bp * e, fr.bp * e); }
});

// =============================================================== FX AND TRANSITION SOUNDS (cue sound design)
def('boom', 'fx', 0.5, 'decay .43 (s) · fall 9 (pitch drop rate) · noise .5', (o, t, p) => {
  const w = W(o, p, 0.5), s0 = S(t), lp = lp1(2200), dec = p.decay ?? 0.43, fall = p.fall ?? 9, nzA = p.noise ?? 0.5, nz = noiseOf(o), n = N(o, s0, Math.min(3, dec * 5.5)); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += TAU * (32 + 90 * Math.exp(-x * fall)) / SR; w(s0 + i, Math.sin(ph) * Math.exp(-x / dec) * 0.9 + lp(nz()) * Math.exp(-x * 4.5) * nzA); }
});
def('riser', 'fx', 0.4, 'dur .6 (s) · span 30 (frequency ratio of the sweep) · curve 1.7', (o, t, p) => {
  const w = W(o, p, 0.4), s0 = S(t), d = p.dur ?? 0.6, n = N(o, s0, d), fl = biquad('bp', 300, 1.5), fr = biquad('bp', 300, 1.5), sp = p.span ?? 30, cv = p.curve ?? 1.7, nz = noiseOf(o), nn = Math.max(1, Math.round(d * SR));
  for (let i = 0; i < n; i++) { const k = i / nn, fc = 250 * Math.pow(sp, k), env = Math.pow(k, cv) * 0.5; w(s0 + i, fl(nz(), fc) * 1.4 * env, fr(nz(), fc * 1.04) * 1.4 * env); }
});
def('whoosh', 'fx', 0.3, 'dur .5 · dir 1 (pan travel) · lo 300 · hi 3800 (Hz band peak)', (o, t, p) => {
  const w = W(o, { ...p, pan: 0 }, 0.3), s0 = S(t), d = p.dur ?? 0.5, n = N(o, s0, d), nn = Math.max(1, Math.round(d * SR)), f = biquad('bp', 800, 1.1), dir = p.dir ?? 1, lo = p.lo ?? 300, hi = p.hi ?? 3800, nz = noiseOf(o);
  for (let i = 0; i < n; i++) { const k = i / nn, env = Math.sin(Math.PI * k) ** 2 * 0.7, fc = lo + (hi - lo) * Math.sin(Math.PI * k), v = f(nz(), fc) * env, [pl, pr] = pan(dir * (-1 + 2 * k) * 0.85); w(s0 + i, v * pl, v * pr); }
});
def('sweep', 'fx', 0.4, 'dur 1 · f0 200 · f1 1200 (Hz; f0 > f1 = downlifter tone)', (o, t, p) => {
  const w = W(o, p, 0.4), s0 = S(t), d = p.dur ?? 1, n = N(o, s0, d), nn = Math.max(1, Math.round(d * SR)), f0 = p.f0 ?? 200, f1 = p.f1 ?? 1200; let ph = 0;
  for (let i = 0; i < n; i++) { const k = i / nn; ph += TAU * f0 * Math.pow(f1 / f0, k) / SR; w(s0 + i, Math.sin(ph) * Math.sin(Math.PI * k) * 0.05); }
});
def('downlifter', 'fx', 0.45, 'dur 1 · f0 6000 · f1 200 (filtered noise falling) · tone .4 (sine share)', (o, t, p) => {
  const w = W(o, p, 0.45), s0 = S(t), d = p.dur ?? 1, n = N(o, s0, d), nn = Math.max(1, Math.round(d * SR)), f0 = p.f0 ?? 6000, f1 = p.f1 ?? 200, tone = p.tone ?? 0.4, flt = svf(), nz = noiseOf(o); let ph = 0;
  for (let i = 0; i < n; i++) { const k = i / nn, fc = f0 * Math.pow(f1 / f0, k); ph += fc * 0.25 / SR; const env = Math.pow(1 - k, 1.4) * Math.min(1, k * 40);
    w(s0 + i, (flt(nz(), fc, 0.5) * (1 - tone) + Math.sin(TAU * ph) * tone * 0.3) * env * 0.6); }
});
def('shepard', 'fx', 0.35, 'dur · f0 40 · oct 8 · rate .5 (octaves/s) · dir 1 (up) | -1 (down) · level .25', (o, t, p) => {
  const w = W(o, p, 0.35), s0 = S(t), dur = p.dur ?? 2, f0 = p.f0 ?? 40, oct = p.oct ?? 8, rate = p.rate ?? 0.5, dir = p.dir ?? 1, g = p.level ?? 0.25, ph = new Float64Array(oct), n = N(o, s0, dur);
  for (let i = 0; i < n; i++) { const x = i / SR, env = Math.min(1, x / 0.3) * Math.min(1, (dur - x) / 0.05); let v = 0;
    for (let k = 0; k < oct; k++) { const pos = (((k + dir * rate * x) % oct) + oct) % oct; ph[k] += f0 * Math.pow(2, pos) / SR; v += Math.sin(TAU * ph[k]) * Math.sin(Math.PI * pos / oct) ** 2; }
    w(s0 + i, v * g * env / oct * 2); }
});
def('doppler', 'fx', 0.3, 'dur .6 (centred on t when used as a cue) · f 1400 (Hz band centre) · shift .35 (pitch swing) · dir 1 · tone 0 (engine-whine sine share)', (o, t, p) => {
  const w = W(o, { ...p, pan: 0 }, 0.3), d = p.dur ?? 0.6, s0 = S(t), n = N(o, s0, d), nn = Math.max(1, Math.round(d * SR)), f = p.f ?? 1400, sh = p.shift ?? 0.35, dir = p.dir ?? 1, tone = p.tone ?? 0, flt = svf(), nz = noiseOf(o); let ph = 0;
  for (let i = 0; i < n; i++) { const x = (i / nn) * 2 - 1, amp = 1 / (x * x * 6 + 0.25) / 4, fc = f * (1 - sh * Math.tanh(3 * x)); ph += fc * 0.3 / SR;
    const v = (flt(nz(), fc, 0.6) * (1 - tone) + Math.sin(TAU * ph) * tone * 0.4) * amp * Math.min(1, (1 - Math.abs(x)) * 8), [pl, pr] = pan(dir * x * 0.9); w(s0 + i, v * pl, v * pr); }
});
def('aperture', 'fx', 0.25, 'ticks 6 · span .06 (s) · ring 3000 (Hz, high-Q) · q 25', (o, t, p) => {
  const w = W(o, p, 0.25), s0 = S(t), nt = p.ticks ?? 6, span = p.span ?? 0.06, b = biquad('bp', p.ring ?? 3000, p.q ?? 25), hb = biquad('bp', 5000, 2), nz = noiseOf(o), n = N(o, s0, span + 0.25);
  const at = Array.from({ length: nt }, (_, k) => Math.round((k / nt + o.rand() * 0.4 / nt) * span * SR));
  for (let i = 0; i < n; i++) { let e = 0; for (const a of at) if (i >= a && i < a + 48) e += 1 - (i - a) / 48; const x = nz() * e; w(s0 + i, hb(x) * 1.5 + b(x) * 4); }
});
def('snip', 'fx', 0.3, 'two metallic clicks + ping (scissor cut)', (o, t, p) => {
  const w = W(o, p, 0.3), nz = noiseOf(o);
  [0, 0.045].forEach((d, k) => { const s0 = S(t + d), f = biquad('bp', 5200 + k * 900, 6), n = N(o, s0, 0.06); for (let i = 0; i < n; i++) { const x = i / SR, v = f(nz()) * 3 * Math.exp(-x * 120) + Math.sin(TAU * (3100 + k * 700) * x) * Math.exp(-x * 60) * 0.25; w(s0 + i, v * (k ? 0.7 : 1), v * (k ? 1 : 0.7)); } });
});
def('shutter', 'fx', 0.2, 'gap .07 (s between the two clicks) · tone 2600', (o, t, p) => {
  const w = W(o, p, 0.2), nz = noiseOf(o);
  [0, p.gap ?? 0.07].forEach(d => { const s0 = S(t + d), f = biquad('bp', p.tone ?? 2600, 3), n = N(o, s0, 0.05); for (let i = 0; i < n; i++) w(s0 + i, f(nz()) * Math.exp(-i / SR * 90) * 2.2); });
});
def('crackle', 'fx', 0.25, 'dur .5 · rate 500 (impulses/s, 300-800) · lo 2000 · hi 6000 (Hz) · body .3 (low noise)', (o, t, p) => {
  const w = W(o, p, 0.25), s0 = S(t), d = p.dur ?? 0.5, n = N(o, s0, d), nn = Math.max(1, Math.round(d * SR)), rate = p.rate ?? 500, lo = p.lo ?? 2000, hi = p.hi ?? 6000, body = p.body ?? 0.3, flt = svf(), lp = lp1(400), nz = noiseOf(o);
  let fc = 3000, burst = 0, bl = 1;
  for (let i = 0; i < n; i++) { const k = i / nn, env = Math.sqrt(Math.sin(Math.PI * k));
    if (o.rand() < rate / SR) { fc = lo + (hi - lo) * o.rand(); burst = Math.round((0.001 + o.rand() * 0.002) * SR); bl = burst; }
    const ex = burst > 0 ? nz() * (burst-- / bl) : 0; w(s0 + i, (flt(ex, fc, 0.7) * 1.0 + lp(nz()) * body) * env); }
});
def('bloop', 'fx', 0.35, 'f0 600 · f1 150 (Hz drop) · decay .12 · bubbles 3', (o, t, p) => {
  const w = W(o, p, 0.35), s0 = S(t), f0 = p.f0 ?? 600, f1 = p.f1 ?? 150, dec = p.decay ?? 0.12, flt = svf(), nz = noiseOf(o), n = N(o, s0, dec * 5); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR, f = f1 + (f0 - f1) * Math.exp(-x / 0.03); ph += f / SR; w(s0 + i, Math.sin(TAU * ph) * Math.exp(-x / dec) * 0.5 + flt(nz(), 2000 * Math.exp(-x / 0.05) + 600, 0.9) * Math.exp(-x / 0.06) * 0.25); }
  for (let b = 0; b < (p.bubbles ?? 3); b++) INST.bubble.play(o, t + dec * 0.6 + b * 0.05 + o.rand() * 0.03, { ...p, f: 1200 + o.rand() * 1800, gain: (p.gain ?? 1) * 0.5 });
});

// =============================================================== FOLEY (pick ONE material family per reel, 03 §4.10)
def('paper', 'foley', 0.2, "mode 'crinkle'|'tear' · dur .4 · rate 500 (crinkle clicks/s)", (o, t, p) => {
  const w = W(o, p, 0.2), s0 = S(t), d = p.dur ?? 0.4, n = N(o, s0, d), nn = Math.max(1, Math.round(d * SR)), nz = noiseOf(o), flt = svf();
  if (p.mode === 'tear') { const b = biquad('bp', 2000, 0.7); let jit = 1; for (let i = 0; i < n; i++) { if (i % 64 === 0) jit = 0.4 + o.rand() * 0.9; const k = i / nn; w(s0 + i, b(nz(), 1000 + 2000 * k) * jit * Math.sin(Math.PI * k) ** 0.5 * 0.9); } return; }
  const rate = p.rate ?? 500; let fc = 4000, burst = 0, bl = 1;
  for (let i = 0; i < n; i++) { const k = i / nn; if (o.rand() < rate / SR * Math.sin(Math.PI * k)) { fc = 2000 + 4000 * o.rand(); burst = Math.round((0.001 + 0.002 * o.rand()) * SR); bl = burst; }
    const ex = burst > 0 ? nz() * (burst-- / bl) : 0; w(s0 + i, flt(ex, fc, 0.5) * 1.1); }
});
def('tapepull', 'foley', 0.2, 'dur .5 · f0 500 · f1 3000 (rising band)', (o, t, p) => {
  const w = W(o, p, 0.2), s0 = S(t), d = p.dur ?? 0.5, n = N(o, s0, d), nn = Math.max(1, Math.round(d * SR)), f = biquad('bp', 500, 2), nz = noiseOf(o), f0 = p.f0 ?? 500, f1 = p.f1 ?? 3000; let imp = 0;
  for (let i = 0; i < n; i++) { const k = i / nn; if (o.rand() < 180 / SR) imp = 0.8; imp *= 0.92; w(s0 + i, (f(nz(), f0 * Math.pow(f1 / f0, k)) * 0.6 + imp * nz()) * Math.sin(Math.PI * k) ** 0.6); }
});
def('squish', 'foley', 0.15, 'dur .25 · f 180 (Hz, bends down) · cut 600', (o, t, p) => {
  const w = W(o, p, 0.15), s0 = S(t), d = p.dur ?? 0.25, n = N(o, s0, d), nn = Math.max(1, Math.round(d * SR)), f = p.f ?? 180, flt = svf(), nz = noiseOf(o); let ph = 0;
  for (let i = 0; i < n; i++) { const k = i / nn; ph += f * (1 - 0.35 * k) / SR; w(s0 + i, (flt(nz(), (p.cut ?? 600) * (1 - 0.4 * k), 0.4) * 0.8 + Math.sin(TAU * ph) * 0.4) * Math.sin(Math.PI * k)); }
});
def('boing', 'foley', 0.25, 'f0 150 · f1 600 (Hz) · dur .6 · wobble 12 (Hz vibrato)', (o, t, p) => {
  const w = W(o, p, 0.25), s0 = S(t), d = p.dur ?? 0.6, n = N(o, s0, d), f0 = p.f0 ?? 150, f1 = p.f1 ?? 600, wb = p.wobble ?? 12; let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR, f = f0 + (f1 - f0) * clamp(x / 0.12), vib = 1 + 0.15 * Math.exp(-x / 0.25) * Math.sin(TAU * wb * x); ph += f * vib / SR; w(s0 + i, Math.sin(TAU * ph) * Math.exp(-x / (d * 0.35)) * 0.35); }
});
def('degauss', 'foley', 0.15, 'hum 50 (Hz; 60 in the Americas) · dur 1 · thump .6', (o, t, p) => {
  const w = W(o, p, 0.15), s0 = S(t), d = p.dur ?? 1, n = N(o, s0, d + 0.15), hum = p.hum ?? 50, th = p.thump ?? 0.6;
  for (let i = 0; i < n; i++) { const x = i / SR, sw = x < d ? Math.pow(x / d, 2) : 0; let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(TAU * hum * h * x) / h; v *= sw * 0.15;
    if (x >= d) v += Math.sin(TAU * 60 * (x - d)) * Math.exp(-(x - d) / 0.04) * th; w(s0 + i, v); }
});
def('channel', 'foley', 0.1, 'whine 15000 (Hz) · len .12', (o, t, p) => {
  const w = W(o, p, 0.1), s0 = S(t), n = N(o, s0, p.len ?? 0.12), h = hp1(3000), nz = noiseOf(o), wh = p.whine ?? 15000;
  for (let i = 0; i < n; i++) { const x = i / SR; w(s0 + i, (i < 120 ? h(nz()) * (1 - i / 120) * 0.7 : 0) + Math.sin(TAU * wh * x) * 0.03 * Math.exp(-x / 0.05)); }
});
def('shing', 'foley', 0.45, 'f 1800 (FM carrier) · ratio 1.41 · dur .6', (o, t, p) => {
  const w = W(o, p, 0.45), s0 = S(t), d = p.dur ?? 0.6, n = N(o, s0, d), f = p.f ?? 1800, r = p.ratio ?? 1.41, flt = svf(), nz = noiseOf(o), nn = Math.max(1, Math.round(0.18 * SR));
  for (let i = 0; i < n; i++) { const x = i / SR, k = Math.min(1, i / nn); w(s0 + i, flt(nz(), 2000 + 7000 * k, 0.3) * (1 - k) * 0.25 * Math.min(1, x * 200) + Math.sin(TAU * f * x + 3 * Math.exp(-x / 0.1) * Math.sin(TAU * f * r * x)) * Math.exp(-x / (d * 0.4)) * 0.15); }
});
def('bubble', 'foley', 0.3, 'f 2000 (Hz) · rise .4 (pitch rise during the decay) · decay .025', (o, t, p) => {
  const w = W(o, p, 0.3), s0 = S(t), f = p.f ?? 2000, rise = p.rise ?? 0.4, dec = p.decay ?? 0.025, n = N(o, s0, dec * 6); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += f * (1 + rise * (1 - Math.exp(-x / dec))) / SR; w(s0 + i, Math.sin(TAU * ph) * Math.exp(-x / dec) * 0.3 * Math.min(1, i / 24)); }
});
def('gel', 'foley', 0.15, 'f 140 (Hz, bends down 30 %) · wobble 22 (Hz AM) · dur .3', (o, t, p) => {
  const w = W(o, p, 0.15), s0 = S(t), d = p.dur ?? 0.3, n = N(o, s0, d), f = p.f ?? 140, wb = p.wobble ?? 22; let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR, k = x / d; ph += f * (1 - 0.3 * k) / SR; w(s0 + i, Math.sin(TAU * ph) * (0.7 + 0.3 * Math.sin(TAU * wb * x)) * Math.sin(Math.PI * Math.min(1, k)) * 0.45); }
});
def('fabric', 'foley', 0.25, 'dur .4 · lo 300 · hi 2000 (cutoff follows the gesture)', (o, t, p) => {
  const w = W(o, p, 0.25), s0 = S(t), d = p.dur ?? 0.4, n = N(o, s0, d), nn = Math.max(1, Math.round(d * SR)), lo = p.lo ?? 300, hi = p.hi ?? 2000, flt = svf(), nz = noiseOf(o);
  for (let i = 0; i < n; i++) { const k = i / nn, g = Math.sin(Math.PI * k); w(s0 + i, flt(nz(), lo + (hi - lo) * g, 0.1) * g * 0.6); }
});
def('stamp', 'foley', 0.2, 'f 90 (Hz thud) · decay .08 · click .3', (o, t, p) => {
  const w = W(o, p, 0.2), s0 = S(t), f = p.f ?? 90, dec = p.decay ?? 0.08, lp = lp1(700), nz = noiseOf(o), n = N(o, s0, dec * 6);
  for (let i = 0; i < n; i++) { const x = i / SR; w(s0 + i, (Math.sin(TAU * f * x) * 0.6 + lp(nz()) * 0.8) * Math.exp(-x / dec) + (i < 72 ? nz() * (p.click ?? 0.3) * (1 - i / 72) : 0)); }
});
def('shatter', 'foley', 0.45, 'n 36 (grains) · spread .25 (s) · lo 2000 · hi 7000 (Hz)', (o, t, p) => {
  const ng = p.n ?? 36, sp = p.spread ?? 0.25, lo = p.lo ?? 2000, hi = p.hi ?? 7000;
  for (let k = 0; k < ng; k++) { const dt = sp * Math.pow(o.rand(), 2), f = lo + (hi - lo) * o.rand();
    modalPlay(o, t + dt, { ...p, f, note: 60, notes: null, decay: 0.03 + o.rand() * 0.12, noise: 0.05, pan: (o.rand() * 2 - 1) * 0.8, gain: (p.gain ?? 1) * (0.25 + 0.5 * o.rand()) / Math.sqrt(ng) * 3 }, 'glass', 0.45, 0.2); }
});
def('click', 'foley', 0.1, 'tone 2200 (Hz) · level 1', (o, t, p) => {
  const w = W(o, p, 0.1), s0 = S(t), n = N(o, s0, 0.012), h = hp1(4000), nz = noiseOf(o), f = p.tone ?? 2200, lv = p.level ?? 1;
  for (let i = 0; i < n; i++) { const x = i / SR; w(s0 + i, ((i < 72 ? h(nz()) * (1 - i / 72) : 0) + Math.sin(TAU * f * x) * Math.exp(-x / 0.002) * 0.4) * lv); }
});

/** list for --list / docs */
export function describe() {
  const kinds = { drum: 'DRUMS & PERCUSSION', tonal: 'TONAL', texture: 'TEXTURES', fx: 'FX & TRANSITION SOUNDS', foley: 'FOLEY' };
  return Object.entries(kinds).map(([k, title]) => `${title}\n` + Object.values(INST).filter(x => x.kind === k).map(x => `  ${x.name.padEnd(11)} ${x.doc}`).join('\n')).join('\n\n');
}
export { MODAL };
