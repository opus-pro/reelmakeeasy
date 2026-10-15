import type { TranscriptData, TranscriptWord } from '@shared/types/agent/transcript'

import type { AudioRegion, EnergySample, MusicSection } from './types'

/** Flatten all transcript words into a single ascending-by-start list. */
export type SungBlock = {
  end: number
  start: number
  words: TranscriptWord[]
}

export function flattenWords(transcript: null | TranscriptData | undefined): TranscriptWord[] {
  if (!transcript) {
    return []
  }
  const words: TranscriptWord[] = []
  for (const seg of transcript.segments) {
    for (const w of seg.words) {
      if (Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start) {
        words.push(w)
      }
    }
  }
  words.sort((a, b) => a.start - b.start)
  return words
}

/**
 * Merge words into "sung blocks": consecutive words whose inter-word gap is <= lineGapSec belong
 * to the same block. A block boundary marks a natural lyric line / phrase boundary.
 */
export function buildSungBlocks(words: TranscriptWord[], lineGapSec: number): SungBlock[] {
  const blocks: SungBlock[] = []
  let current: null | SungBlock = null
  for (const w of words) {
    if (current === null) {
      current = { end: w.end, start: w.start, words: [w] }
      continue
    }
    if (w.start - current.end <= lineGapSec) {
      current.end = Math.max(current.end, w.end)
      current.words.push(w)
    } else {
      blocks.push(current)
      current = { end: w.end, start: w.start, words: [w] }
    }
  }
  if (current !== null) {
    blocks.push(current)
  }
  return blocks
}

/**
 * Build the full region map over [0, audioDuration]:
 *  - 'sung' regions cover sung blocks,
 *  - the complement is word-less, classified as intro / break / outro.
 * With musical sections + energy, intro/outro are derived from ENERGY (robust to background
 * vocals/ad-libs - they barely move energy). Else fall back to lyric gaps.
 */
export function buildAudioRegions(
  words: TranscriptWord[],
  audioDurationSec: number,
  lineGapSec: number,
  minWordlessSec = 2.5,
  sections: MusicSection[] = [],
  energy: EnergySample[] = [],
): AudioRegion[] {
  if (sections.length >= 2 && energy.length >= 4) {
    return buildEnergySectionRegions(words, audioDurationSec, lineGapSec, minWordlessSec, energy)
  }
  return buildLyricRegions(words, audioDurationSec, lineGapSec, minWordlessSec)
}

function buildEnergySectionRegions(
  words: TranscriptWord[],
  audioDurationSec: number,
  lineGapSec: number,
  minWordlessSec: number,
  energy: EnergySample[],
): AudioRegion[] {
  const duration = Math.max(0, audioDurationSec)
  // Detect intro/outro as SUSTAINED low-energy EDGE regions directly on the envelope (robust to
  // transient 1-bar dips and to a coarse section that mixes loud+quiet).
  const rms = energy.map((e) => e.rms)
  const sortedRms = [...rms].sort((p, q) => p - q)
  const median = sortedRms[Math.floor(sortedRms.length / 2)] ?? 0
  const threshold = 0.45 * median
  const W = 10 // ~1s smoothing on the ~10 Hz envelope
  const sm = rms.map((_, idx) => {
    let sum = 0
    let count = 0
    for (let k = Math.max(0, idx - W); k <= Math.min(rms.length - 1, idx + W); k++) {
      sum += rms[k] ?? 0
      count++
    }
    return count ? sum / count : 0
  })
  let a = 0
  while (a < sm.length && (sm[a] ?? threshold) < threshold) {
    a++
  }
  let introEnd = a < energy.length ? (energy[a]?.t ?? 0) : 0
  // A purely instrumental lead-in (no vocals at all) is also an intro, even at full energy
  // (e.g. a track whose vocals start 13s in). Take the more-inclusive edge.
  const firstWord = words.length > 0 ? (words[0]?.start ?? 0) : 0
  if (firstWord > introEnd && firstWord < 0.35 * duration) {
    introEnd = firstWord
  }
  let b = sm.length - 1
  while (b >= 0 && (sm[b] ?? threshold) < threshold) {
    b--
  }
  const outroStart = b >= 0 ? (energy[b]?.t ?? duration) : duration

  const regions: AudioRegion[] = []
  if (introEnd > minWordlessSec) {
    regions.push({ end: introEnd, kind: 'wordless-intro', start: 0 })
  }
  regions.push(...buildLyricBodyRegions(words, introEnd, outroStart, lineGapSec, minWordlessSec))
  if (duration - outroStart > minWordlessSec) {
    regions.push({ end: duration, kind: 'wordless-outro', start: outroStart })
  }
  if (regions.length === 0 && duration > 0) {
    regions.push({ end: duration, kind: 'wordless-intro', start: 0 })
  }
  return regions
}

/** Clamp sung blocks into [lo,hi] and merge any separated by < minWordlessSec into one span. */
function mergeBlocksToSpans(
  blocks: SungBlock[],
  lo: number,
  hi: number,
  minWordlessSec: number,
): { end: number; start: number }[] {
  const spans: { end: number; start: number }[] = []
  for (const blk of blocks) {
    const start = Math.max(lo, Math.min(blk.start, hi))
    const end = Math.max(start, Math.min(blk.end, hi))
    const last = spans[spans.length - 1]
    if (last && start - last.end < minWordlessSec) {
      last.end = Math.max(last.end, end)
    } else {
      spans.push({ end, start })
    }
  }
  return spans
}

/** Convert merged sung spans into alternating instrumental-break / sung regions. */
function spansToSungAndBreaks(
  spans: { end: number; start: number }[],
  firstSungStart: number,
): AudioRegion[] {
  const regions: AudioRegion[] = []
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]
    if (!s) {
      continue
    }
    const prev = spans[i - 1]
    if (prev && s.start - prev.end > 1e-3) {
      regions.push({ end: s.start, kind: 'wordless-break', start: prev.end })
    }
    regions.push({ end: s.end, kind: 'sung', start: i === 0 ? firstSungStart : s.start })
  }
  return regions
}

/** Sung + instrumental-break regions inside the active body [bodyStart, bodyEnd] (lyric-driven). */
function buildLyricBodyRegions(
  words: TranscriptWord[],
  bodyStart: number,
  bodyEnd: number,
  lineGapSec: number,
  minWordlessSec: number,
): AudioRegion[] {
  if (bodyEnd - bodyStart < 1e-3) {
    return []
  }
  const bodyWords = words.filter((w) => w.end > bodyStart && w.start < bodyEnd)
  if (bodyWords.length === 0) {
    return [{ end: bodyEnd, kind: 'sung', start: bodyStart }]
  }
  const blocks = buildSungBlocks(bodyWords, lineGapSec)
  const spans = mergeBlocksToSpans(blocks, bodyStart, bodyEnd, minWordlessSec)
  const regions = spansToSungAndBreaks(spans, bodyStart)
  const lastR = regions[regions.length - 1]
  if (lastR) {
    lastR.end = bodyEnd
  }
  return regions
}

function buildLyricRegions(
  words: TranscriptWord[],
  audioDurationSec: number,
  lineGapSec: number,
  minWordlessSec: number,
): AudioRegion[] {
  const duration = Math.max(0, audioDurationSec)
  if (words.length === 0) {
    return duration > 0 ? [{ end: duration, kind: 'wordless-intro', start: 0 }] : []
  }

  // Merge any blocks separated by a gap < minWordlessSec so short pauses (e.g. rap breaths) stay
  // INSIDE the sung region. Only gaps >= minWordlessSec survive as real word-less regions.
  const spans = mergeBlocksToSpans(buildSungBlocks(words, lineGapSec), 0, duration, minWordlessSec)
  const firstSpan = spans[0]
  if (!firstSpan) {
    return duration > 0 ? [{ end: duration, kind: 'wordless-intro', start: 0 }] : []
  }

  const regions: AudioRegion[] = []
  // Intro only counts as a region if it is itself >= minWordlessSec; else fold into sung.
  const introCovered = firstSpan.start >= minWordlessSec
  if (introCovered) {
    regions.push({ end: firstSpan.start, kind: 'wordless-intro', start: 0 })
  }
  regions.push(...spansToSungAndBreaks(spans, introCovered ? firstSpan.start : 0))

  // Outro only counts if >= minWordlessSec; else extend the last sung region to the end.
  const lastSpan = spans[spans.length - 1]
  if (lastSpan && duration - lastSpan.end >= minWordlessSec) {
    regions.push({ end: duration, kind: 'wordless-outro', start: lastSpan.end })
  } else {
    const lastRegion = regions[regions.length - 1]
    if (lastRegion) {
      lastRegion.end = duration
    }
  }
  return regions
}

/** Index of the beat nearest to `t` (returns -1 if no beats). */
export function nearestBeatIndex(beats: number[], t: number): number {
  if (beats.length === 0) {
    return -1
  }
  let lo = 0
  let hi = beats.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const v = beats[mid]
    if (v === undefined) {
      break
    }
    if (v < t) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  const candidates: number[] = []
  if (lo < beats.length) {
    candidates.push(lo)
  }
  if (lo - 1 >= 0) {
    candidates.push(lo - 1)
  }
  let best = candidates[0] ?? 0
  let bestDist = Number.POSITIVE_INFINITY
  for (const idx of candidates) {
    const v = beats[idx]
    if (v === undefined) {
      continue
    }
    const d = Math.abs(v - t)
    if (d < bestDist) {
      bestDist = d
      best = idx
    }
  }
  return best
}

/** Beat time nearest to `t` (returns `t` unchanged if no beats). */
export function snapToBeat(beats: number[], t: number): number {
  const idx = nearestBeatIndex(beats, t)
  if (idx < 0) {
    return t
  }
  return beats[idx] ?? t
}

/** Is `t` within `tolerance` of any beat? */
export function isOnBeat(beats: number[], t: number, tolerance: number): boolean {
  const idx = nearestBeatIndex(beats, t)
  if (idx < 0) {
    return false
  }
  const v = beats[idx]
  if (v === undefined) {
    return false
  }
  return Math.abs(v - t) <= tolerance
}

/** Concatenate the word text overlapping [start, end]. */
export function textForRange(words: TranscriptWord[], start: number, end: number): string {
  return words
    .filter((w) => w.end > start && w.start < end)
    .map((w) => w.word)
    .join(' ')
    .trim()
}

/** Mean RMS energy over [start, end] from a sampled envelope (nearest sample if none in range). */
export function meanEnergyInRange(energy: EnergySample[], start: number, end: number): number {
  const inRange = energy.filter((e) => e.t >= start && e.t <= end)
  if (inRange.length === 0) {
    let nearest = 0
    let nearestDist = Number.POSITIVE_INFINITY
    const mid = (start + end) / 2
    for (const e of energy) {
      const d = Math.abs(e.t - mid)
      if (d < nearestDist) {
        nearestDist = d
        nearest = e.rms
      }
    }
    return nearest
  }
  const sum = inRange.reduce((acc, e) => acc + e.rms, 0)
  return sum / inRange.length
}

/** Value at the given percentile (0..1) of the RMS envelope. */
export function energyPercentile(energy: EnergySample[], percentile: number): number {
  if (energy.length === 0) {
    return 0
  }
  const sorted = energy.map((e) => e.rms).sort((a, b) => a - b)
  const clamped = Math.min(1, Math.max(0, percentile))
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(clamped * (sorted.length - 1))))
  return sorted[idx] ?? 0
}
