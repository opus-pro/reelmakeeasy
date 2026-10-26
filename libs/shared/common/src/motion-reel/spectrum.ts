/** The FFT pieces the music analysis shares (beat grid and music events). */

/**
 * How far an onset's flux peak runs ahead of the sound itself: a frame is stamped with its
 * window's start, and the log spectrum jumps as soon as an attack enters the window. Measured on
 * clicks, a rendered score and produced tracks (about 25-35 ms); every time the grid reports is
 * moved by it, so beats land on the hits rather than a frame before them.
 */
export const ONSET_LAG_SEC = 0.028

/** In-place iterative radix-2 FFT (size must be a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0]
      ;[im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let start = 0; start < n; start += size) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < size / 2; k++) {
        const a = start + k
        const b = a + size / 2
        const tr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci
        const ti = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr
        re[b] = (re[a] ?? 0) - tr
        im[b] = (im[a] ?? 0) - ti
        re[a] = (re[a] ?? 0) + tr
        im[a] = (im[a] ?? 0) + ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

/** A Hann window of `size` samples. */
export function hann(size: number): Float64Array {
  const window = new Float64Array(size)
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
  return window
}
