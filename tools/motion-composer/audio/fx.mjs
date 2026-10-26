// Bus effects: they process already-rendered audio over a time window. Used by cue kinds (gap, tapestop,
// bitcrush, reverse, granular, filter, stutter) and by music.mjs section/global `fx` lists.
// All operate in place on Float32Array pairs (L, R), deterministic (seeded rng for granular), with short
// ramps at both edges so nothing clicks. Times in seconds.

import { SR, S, clamp, biquad, readAt, hann, rng as mkRng } from './dsp.mjs';

const RAMP = Math.round(0.003 * SR);

/** smooth 0..1 crossfade weight for sample i in [a, b) with ramps of r samples at each edge */
const win = (i, a, b, r = RAMP) => (i < a || i >= b ? 0 : Math.min(1, (i - a) / r, (b - 1 - i) / r));

/** gap: silence [t, t+dur) on these buses (the strongest transition sound; 1/16 to 1 beat before a hero hit) */
export function gap(L, R, { t, dur = 0.125 }) {
  const a = S(t), b = S(t + dur), n = L.length;
  for (let i = Math.max(0, a - RAMP); i < Math.min(n, b + RAMP); i++) {
    const g = i < a ? (a - i) / RAMP : i >= b ? (i - b) / RAMP : 0;
    L[i] *= g; R[i] *= g;
  }
}

/** tape stop: playback rate falls 1 -> 0 over dur (r = 1 - (x/dur)^curve), then silence until `resume` (s). */
export function tapestop(L, R, { t, dur = 0.5, curve = 1.5, resume = null }) {
  const a = S(t), n = Math.round(dur * SR), end = Math.min(L.length, a + n), srcL = L.slice(a, Math.min(L.length, a + n + 4)), srcR = R.slice(a, Math.min(R.length, a + n + 4));
  const pw = curve + 1, dpow = Math.pow(dur, curve);
  for (let i = a; i < end; i++) {
    const x = (i - a) / SR, pos = (x - Math.pow(x, pw) / (pw * dpow)) * SR, fade = Math.min(1, (end - i) / (0.08 * n + 1));
    L[i] = readAt(srcL, pos) * fade; R[i] = readAt(srcR, pos) * fade;
  }
  const r = resume != null ? S(resume) : end;
  for (let i = end; i < Math.min(L.length, r); i++) { L[i] = 0; R[i] = 0; }
  if (r > end) for (let i = r; i < Math.min(L.length, r + RAMP); i++) { const g = (i - r) / RAMP; L[i] *= g; R[i] *= g; }
}

/** bitcrush: sample-and-hold every `hold` samples, quantise to `bits`, wet `mix` */
export function bitcrush(L, R, { t, dur = 0.5, bits = 6, hold = 4, mix = 1 }) {
  const a = S(t), b = Math.min(L.length, S(t + dur)), q = Math.pow(2, bits - 1); let hl = 0, hr = 0;
  for (let i = a; i < b; i++) {
    if ((i - a) % Math.max(1, Math.round(hold)) === 0) { hl = Math.round(L[i] * q) / q; hr = Math.round(R[i] * q) / q; }
    const w = win(i, a, b) * mix; L[i] = L[i] * (1 - w) + hl * w; R[i] = R[i] * (1 - w) + hr * w;
  }
}

/** rewind: replace [t, t+dur) with the preceding dur*speed seconds played backwards at `speed` (pitch up) */
export function rewind(L, R, { t, dur = 0.5, speed = 1.5 }) {
  const a = S(t), b = Math.min(L.length, S(t + dur)), src0 = Math.max(0, a - Math.round(dur * speed * SR)), srcL = L.slice(src0, a), srcR = R.slice(src0, a);
  for (let i = a; i < b; i++) { const pos = srcL.length - 1 - (i - a) * speed, w = win(i, a, b); L[i] = L[i] * (1 - w) + readAt(srcL, pos) * w; R[i] = R[i] * (1 - w) + readAt(srcR, pos) * w; }
}

/** reverse swell: the dur seconds AFTER t, reversed, faded in, added so that it ENDS exactly at t */
export function swell(L, R, { t, dur = 0.6, gain = 0.6, curve = 2 }, srcL = L, srcR = R) {
  const a = S(t), n = Math.round(dur * SR), cl = srcL.slice(a, a + n), cr = srcR.slice(a, a + n);
  for (let k = 0; k < n; k++) { const i = a - n + k; if (i < 0 || i >= L.length) continue; const j = n - 1 - k, g = Math.pow(k / n, curve) * gain; L[i] += (cl[j] ?? 0) * g; R[i] += (cr[j] ?? 0) * g; }
}

/** granular: grains read around `src` (s), jittered, pitch-scattered, Hann-windowed; mode 'replace' | 'add' */
export function granular(L, R, { t, dur = 1, src = null, grain = 0.05, density = 40, scatter = 7, jitter = 0.08, mode = 'replace', gain = 1, seed = 1 }) {
  const r = mkRng(seed), a = S(t), b = Math.min(L.length, S(t + dur)), sp = S(src ?? t), gN = Math.max(16, Math.round(grain * SR));
  const s0 = Math.max(0, sp - Math.round(jitter * SR) - gN * 2), s1 = Math.min(L.length, sp + Math.round(jitter * SR) + gN * 4), cl = L.slice(s0, s1), cr = R.slice(s0, s1);
  const overlap = Math.max(1, density * grain), norm = gain / Math.sqrt(overlap) * 1.2;
  const outL = new Float32Array(b - a), outR = new Float32Array(b - a), count = Math.round(density * dur);
  for (let k = 0; k < count; k++) {
    const st = Math.round((k / count) * (b - a) + (r() - 0.5) * SR / density), pos = sp - s0 + (r() * 2 - 1) * jitter * SR, ratio = Math.pow(2, (r() * 2 - 1) * scatter / 12), pn = (r() - 0.5) * 0.6;
    for (let n = 0; n < gN; n++) { const o = st + n; if (o < 0 || o >= outL.length) continue; const w = hann(n / gN) * norm, x = pos + n * ratio; outL[o] += readAt(cl, x) * w * (1 - pn); outR[o] += readAt(cr, x) * w * (1 + pn); }
  }
  for (let i = a; i < b; i++) { const w = win(i, a, b, RAMP * 3); const keep = mode === 'replace' ? 1 - w : 1; L[i] = L[i] * keep + outL[i - a] * w; R[i] = R[i] * keep + outR[i - a] * w; }
}

/** filter sweep on the bus: cutoff f0 -> f1 (exponential) over dur, held for `hold` s, then released over `release` */
export function filter(L, R, { t, dur = 1, type = 'lp', f0 = null, f1 = null, q = 0.9, hold = 0, release = 0.01 }) {
  f0 = f0 ?? (type === 'hp' ? 30 : 18000); f1 = f1 ?? (type === 'hp' ? 1200 : 400);
  const a = S(t), b = Math.min(L.length, S(t + dur + hold + release)), fl = biquad(type, f0, q), fr = biquad(type, f0, q), d = Math.max(1, dur * SR), hEnd = S(t + dur + hold), relN = Math.max(1, release * SR);
  for (let i = a; i < b; i++) {
    const k = clamp((i - a) / d), fc = f0 * Math.pow(f1 / f0, k), wl = fl(L[i], fc), wr = fr(R[i], fc);
    const w = Math.min(1, (i - a) / RAMP) * (i < hEnd ? 1 : Math.max(0, 1 - (i - hEnd) / relN));
    L[i] = L[i] * (1 - w) + wl * w; R[i] = R[i] * (1 - w) + wr * w;
  }
}

/** stutter: repeat the first `len` seconds of the window across [t, t+dur) */
export function stutter(L, R, { t, dur = 0.5, len = 0.0625 }) {
  const a = S(t), b = Math.min(L.length, S(t + dur)), n = Math.max(32, Math.round(len * SR)), cl = L.slice(a, a + n), cr = R.slice(a, a + n), r = Math.min(96, n >> 3);
  for (let i = a + n; i < b; i++) { const j = (i - a) % n, g = Math.min(1, j / r, (n - 1 - j) / r), w = win(i, a + n, b); L[i] = L[i] * (1 - w) + cl[j] * g * w; R[i] = R[i] * (1 - w) + cr[j] * g * w; }
}

export const BUS_FX = { gap, tapestop, bitcrush, rewind, granular, filter, stutter };

// ---------------------------------------------------------------- per-voice inserts
// A voice with `fx: [ {type, ...}, ... ]` renders into its own buffer, runs this chain, then joins its bus
// (reverb/delay sends are taken AFTER the chain). Whole-voice, whole-reel; for a time window use bus fx instead.
export const INSERT_DOC = {
  crush: 'bits 6 · hold 4 (samples between sample-and-hold updates; or rate Hz) · mix 1',
  drive: 'g 2 (tanh, normalised) · mix 1',
  lp: 'f 2000 · q .707 (also hp, bp, notch)', peak: 'f · q · gain (dB) (also lowshelf, highshelf)',
  autofilter: "filter 'lp'|'hp'|'bp' · lo 300 · hi 3000 (Hz) · div 1 (LFO cycles per beat) or rate (Hz) · q .9 · phase 0 (0..1)",
  tremolo: 'div 2 (cycles per beat) or rate (Hz) · depth .5 · stereo 0 (0..1 phase offset of R)',
  gain: 'db 0',
};
export function applyInserts(L, R, chain, { bpm = 120 } = {}) {
  const n = L.length, beatHz = bpm / 60;
  for (const fx of [].concat(chain || [])) {
    const ty = fx.type ?? fx.kind;
    if (ty === 'crush') {
      const q = Math.pow(2, (fx.bits ?? 6) - 1), hold = fx.rate ? Math.max(1, Math.round(SR / fx.rate)) : Math.max(1, Math.round(fx.hold ?? 4)), mix = fx.mix ?? 1;
      let hl = 0, hr = 0;
      for (let i = 0; i < n; i++) { if (i % hold === 0) { hl = Math.round(L[i] * q) / q; hr = Math.round(R[i] * q) / q; } L[i] += (hl - L[i]) * mix; R[i] += (hr - R[i]) * mix; }
    } else if (ty === 'drive') {
      const g = fx.g ?? 2, k = Math.tanh(g), mix = fx.mix ?? 1;
      for (let i = 0; i < n; i++) { L[i] += (Math.tanh(g * L[i]) / k - L[i]) * mix; R[i] += (Math.tanh(g * R[i]) / k - R[i]) * mix; }
    } else if (['lp', 'hp', 'bp', 'notch', 'peak', 'lowshelf', 'highshelf'].includes(ty)) {
      const fl = biquad(ty, fx.f ?? 2000, fx.q ?? 0.707, fx.gain ?? 0), fr = biquad(ty, fx.f ?? 2000, fx.q ?? 0.707, fx.gain ?? 0);
      for (let i = 0; i < n; i++) { L[i] = fl(L[i]); R[i] = fr(R[i]); }
    } else if (ty === 'autofilter') {
      const rate = fx.rate ?? beatHz * (fx.div ?? 1), lo = fx.lo ?? 300, hi = fx.hi ?? 3000, ph = (fx.phase ?? 0) * 2 * Math.PI, ft = fx.filter ?? 'lp';
      const fl = biquad(ft, lo, fx.q ?? 0.9), fr = biquad(ft, lo, fx.q ?? 0.9);
      for (let i = 0; i < n; i++) { const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * rate * i / SR + ph), fc = lo * Math.pow(hi / lo, k); L[i] = fl(L[i], fc); R[i] = fr(R[i], fc); }
    } else if (ty === 'tremolo') {
      const rate = fx.rate ?? beatHz * (fx.div ?? 2), d = clamp(fx.depth ?? 0.5), st = (fx.stereo ?? 0) * 2 * Math.PI;
      for (let i = 0; i < n; i++) { const a = 2 * Math.PI * rate * i / SR; L[i] *= 1 - d * (0.5 - 0.5 * Math.cos(a)); R[i] *= 1 - d * (0.5 - 0.5 * Math.cos(a + st)); }
    } else if (ty === 'gain') {
      const g = Math.pow(10, (fx.db ?? 0) / 20); for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
    } else throw new Error(`voice fx type "${ty}" unknown (${Object.keys(INSERT_DOC).join(', ')}, hp, bp, notch, lowshelf, highshelf)`);
  }
}
