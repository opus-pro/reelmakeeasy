// DSP primitives shared by the composer (score.mjs) and the instrument library.
// Everything is deterministic: no Math.random, no Date. Randomness comes from rng(seed).
// Sample rate is fixed at 48 kHz (the master and the video mux both expect it).

export const SR = 48000;
export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const ftom = f => 69 + 12 * Math.log2(f / 440);
export const db = g => 20 * Math.log10(Math.max(1e-12, g));
export const undb = d => Math.pow(10, d / 20);
export const S = t => Math.round(t * SR);            // seconds -> sample index

/** mulberry32-style PRNG in [0,1). Same seed, same stream. */
export function rng(seed = 1) {
  let s = (seed >>> 0) || 0x9E3779B9;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** FNV-1a 32-bit hash of a string (stable sub-seeds per voice / per cue). */
export function hash(str) {
  let h = 0x811C9DC5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ---------------------------------------------------------------- waveforms (phase in cycles)
export const saw = p => 2 * (p - Math.floor(p + 0.5));
export const sqr = p => ((p - Math.floor(p)) < 0.5 ? 1 : -1);
export const pulse = (p, duty = 0.5) => ((p - Math.floor(p)) < duty ? 1 : -1);
export const tri = p => { const f = p - Math.floor(p); return f < 0.5 ? 4 * f - 1 : 3 - 4 * f; };
/** constant-power pan, scaled so that centre = unity on both sides */
export const pan = p => { const a = (clamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]; };
/** soft clip with unity small-signal gain; drive <= 0 means bypass */
export const soft = (x, drive = 1) => (drive > 0 ? Math.tanh(x * drive) / drive : x);
/** normalised tanh drive (keeps peak near 1 for |x| = 1) */
export const drive = (x, g = 2) => Math.tanh(g * x) / Math.tanh(g);

// ---------------------------------------------------------------- filters
export function lp1(fc) { const a = Math.exp(-TAU * fc / SR); let y = 0; return x => (y = (1 - a) * x + a * y); }
export function hp1(fc) { const lp = lp1(fc); return x => x - lp(x); }
/** RBJ biquad. type: lp | hp | bp | notch | peak | lowshelf | highshelf. f may be changed per call: proc(x, f). */
export function biquad(type, f0 = 1000, q = 0.707, gainDb = 0) {
  let b0, b1, b2, a1, a2, lastF = -1, lastQ = -1, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const set = (f, Q) => {
    f = clamp(f, 10, SR * 0.49); lastF = f; lastQ = Q;
    const w = TAU * f / SR, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * Q), A = Math.pow(10, gainDb / 40);
    let n0, n1, n2, d0, d1, d2;
    switch (type) {
      case 'lp': n0 = (1 - cw) / 2; n1 = 1 - cw; n2 = n0; d0 = 1 + al; d1 = -2 * cw; d2 = 1 - al; break;
      case 'hp': n0 = (1 + cw) / 2; n1 = -(1 + cw); n2 = n0; d0 = 1 + al; d1 = -2 * cw; d2 = 1 - al; break;
      case 'bp': n0 = al; n1 = 0; n2 = -al; d0 = 1 + al; d1 = -2 * cw; d2 = 1 - al; break;
      case 'notch': n0 = 1; n1 = -2 * cw; n2 = 1; d0 = 1 + al; d1 = -2 * cw; d2 = 1 - al; break;
      case 'peak': n0 = 1 + al * A; n1 = -2 * cw; n2 = 1 - al * A; d0 = 1 + al / A; d1 = -2 * cw; d2 = 1 - al / A; break;
      case 'lowshelf': { const s = 2 * Math.sqrt(A) * al; n0 = A * ((A + 1) - (A - 1) * cw + s); n1 = 2 * A * ((A - 1) - (A + 1) * cw); n2 = A * ((A + 1) - (A - 1) * cw - s); d0 = (A + 1) + (A - 1) * cw + s; d1 = -2 * ((A - 1) + (A + 1) * cw); d2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'highshelf': { const s = 2 * Math.sqrt(A) * al; n0 = A * ((A + 1) + (A - 1) * cw + s); n1 = -2 * A * ((A - 1) + (A + 1) * cw); n2 = A * ((A + 1) + (A - 1) * cw - s); d0 = (A + 1) - (A - 1) * cw + s; d1 = 2 * ((A - 1) - (A + 1) * cw); d2 = (A + 1) - (A - 1) * cw - s; break; }
      default: throw new Error(`biquad: unknown type ${type}`);
    }
    b0 = n0 / d0; b1 = n1 / d0; b2 = n2 / d0; a1 = d1 / d0; a2 = d2 / d0;
  };
  set(f0, q);
  return (x, f, Q) => {
    if ((f !== undefined && Math.abs(f - lastF) > 0.5) || (Q !== undefined && Q !== lastQ)) set(f ?? lastF, Q ?? lastQ);
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; return y;
  };
}
/** Topology-preserving state-variable filter (Zavalishin). Stable under fast cutoff modulation.
 *  const f = svf(); f(x, fc, res) -> f.lp / f.bp / f.hp (res 0..0.98, higher = more resonance) */
export function svf() {
  let ic1 = 0, ic2 = 0, lf = -1, lr = -1, g = 0, k = 2, a1 = 1, a2 = 0, a3 = 0;
  const out = (x, fc, res = 0) => {
    // recompute coefficients only when cutoff moves > 0.05 % or resonance changes (tan() is the hot spot)
    if (Math.abs(fc - lf) > lf * 0.0005 || res !== lr) {
      lf = fc; lr = res; g = Math.tan(Math.PI * clamp(fc, 10, SR * 0.45) / SR); k = 2 - 2 * clamp(res, 0, 0.98);
      a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    }
    const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    out.lp = v2; out.bp = v1; out.hp = x - k * v1 - v2; return v2;
  };
  out.lp = 0; out.bp = 0; out.hp = 0;
  return out;
}

// ---------------------------------------------------------------- oscillators for additive synthesis
/** Recursive sine (rotating phasor): 4 multiplies per sample, no Math.sin in the loop. */
export function sinOsc(f, phase = 0) {
  const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w);
  let x = Math.cos(phase), y = Math.sin(phase), n = 0;
  return () => {
    const v = y; const nx = x * c - y * s; y = x * s + y * c; x = nx;
    if (++n === 4096) { n = 0; const m = 1 / Math.hypot(x, y); x *= m; y *= m; }  // renormalise drift
    return v;
  };
}

// ---------------------------------------------------------------- envelopes
/** attack (s) then exponential decay with time-constant tau (s) */
export const adExp = (x, a, tau) => (x < a ? x / a : Math.exp(-(x - a) / tau));
/** linear-attack, hold to `dur`, exponential release; returns 0 after dur + 6*rel */
export function ahr(x, a, dur, rel) {
  if (x < 0) return 0;
  const at = a > 0 ? Math.min(1, x / a) : 1;
  return x <= dur ? at : at * Math.exp(-(x - dur) / Math.max(1e-4, rel));
}

// ---------------------------------------------------------------- buses
/** A stereo bus with a reverb send and a delay send. */
export class Bus {
  constructor(n, name = 'bus') {
    this.n = n; this.name = name;
    this.L = new Float32Array(n); this.R = new Float32Array(n);
    this.sL = new Float32Array(n); this.sR = new Float32Array(n);   // reverb send
    this.dL = new Float32Array(n); this.dR = new Float32Array(n);   // delay send
    this.used = false;
  }
  add(i, l, r, send = 0, dsend = 0) {
    if (i < 0 || i >= this.n) return;
    if (l !== l || r !== r) return;          // drop NaN instead of poisoning the mix
    this.L[i] += l; this.R[i] += r; this.used = true;
    if (send) { this.sL[i] += l * send; this.sR[i] += r * send; }
    if (dsend) { this.dL[i] += l * dsend; this.dR[i] += r * dsend; }
  }
}

/** Freeverb-style room (6 combs + 3 allpasses per side). size 0.7..0.95 = comb feedback, damp 0..0.9. */
export function reverb({ size = 0.83, damp = 0.32, side = 0 } = {}) {
  const comb = (n, fb, dmp) => { const buf = new Float32Array(n); let i = 0, st = 0; return x => { const y = buf[i]; st = y * (1 - dmp) + st * dmp; buf[i] = x + st * fb; i = (i + 1) % n; return y; }; };
  const allp = n => { const buf = new Float32Array(n); let i = 0; return x => { const b = buf[i], y = -x + b; buf[i] = x + b * 0.5; i = (i + 1) % n; return y; }; };
  const off = side ? 23 : 0;
  const cs = [1116, 1188, 1277, 1356, 1422, 1491].map(n => comb(Math.round((n + off) * SR / 44100), size, damp));
  const as = [556, 341, 225].map(n => allp(Math.round((n + off) * SR / 44100)));
  return x => { let s = 0; for (let k = 0; k < cs.length; k++) s += cs[k](x); s *= 0.12; for (let k = 0; k < as.length; k++) s = as[k](s); return s; };
}

/** Feedback delay with a low-pass in the loop. time in seconds. */
export function delayLine({ time = 0.375, fb = 0.35, lp = 3500 } = {}) {
  const n = Math.max(1, Math.round(time * SR)), buf = new Float32Array(n), f = lp1(lp); let i = 0;
  return x => { const y = buf[i]; buf[i] = x + f(y) * fb; i = (i + 1) % n; return y; };
}

/** Linked look-ahead peak limiter on a stereo pair (in place). ceiling linear, look-ahead/release in s. */
export function limit(L, R, ceiling, { look = 0.005, release = 0.06 } = {}) {
  const n = L.length, la = Math.max(1, Math.round(look * SR)), need = new Float32Array(n);
  let hits = 0;
  for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])); need[i] = p > ceiling ? ceiling / p : 1; if (p > ceiling) hits++; }
  if (!hits) return 0;
  // sliding-window minimum of `need` over [i, i+la) with a monotonic deque (O(n))
  const g = new Float32Array(n), rel = Math.exp(-1 / (release * SR)), dq = new Int32Array(n);
  let head = 0, tail = 0, env = 1, pushed = 0;
  for (let i = 0; i < n; i++) {
    const end = Math.min(n, i + la);
    while (pushed < end) { while (tail > head && need[dq[tail - 1]] >= need[pushed]) tail--; dq[tail++] = pushed++; }
    while (dq[head] < i) head++;
    const m = need[dq[head]];
    env = m < env ? m : m - (m - env) * rel;     // instant attack (already looked ahead), smooth release
    g[i] = env;
  }
  for (let i = 0; i < n; i++) { L[i] *= g[i]; R[i] *= g[i]; }
  return hits;
}

/** Hann window value for k in [0, 1] */
export const hann = k => 0.5 - 0.5 * Math.cos(TAU * clamp(k));

/** Linear-interpolated read from a Float32Array at fractional index */
export const readAt = (a, x) => { const i = Math.floor(x); if (i < 0 || i >= a.length - 1) return 0; const f = x - i; return a[i] * (1 - f) + a[i + 1] * f; };
