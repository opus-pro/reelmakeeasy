// Pure BGM volume-curve math shared by the export mix (node/ffmpeg callers)
// and the live web preview. Browser-safe on purpose: no node imports here --
// the web editor imports this module directly, while bgm-mix/bgm-remux
// re-export these names for their existing node-side consumers.

/**
 * How far (dB) the bed sits below the voiceover in the export mix at full
 * volume: 0 -- slider 100 plays the bed at the voiceover's own
 * (LUFS-matched) loudness. Was 10
 * until full volume turned out to still feel quiet.
 */
export const BGM_DUCK_DB = 0

/**
 * Panel volume when a project has no persisted bgmVolume: 60%, clearly under
 * the voiceover (a 16 dB duck on the current curve) so the narration leads.
 * Was 90 until the owner asked for quieter music by default.
 * Also anchors the creation-time bake via computeBgmGainDb's default duck, so
 * a fresh delivery matches what the panel shows.
 */
export const BGM_DEFAULT_VOLUME = 60

/** Ceiling on the bed gain applied in the export mix (quiet-bed boost cap). */
export const BGM_GAIN_MAX_DB = 6

/** Floor on the bed gain applied in the export mix. */
export const BGM_GAIN_MIN_DB = -30

// The panel slider (0-100) maps onto a duck range below the voiceover:
// 100 plays the bed at voiceover parity (BGM_DUCK_DB) and each step down
// buries the bed 0.4 dB deeper, bottoming out ~40 dB under at 1 (the same
// floor as the previous curve; the old -10 dB default now sits at 75).
// Zero means "no bed" and is handled by the caller (voiceover-only rebuild),
// not by this mapping.
export const BGM_VOLUME_DUCK_RANGE_DB = 40

export function resolveBgmDuckDbForVolume(volume: number): number {
  const clamped = Math.max(0, Math.min(volume, 100))
  return BGM_DUCK_DB + ((100 - clamped) / 100) * BGM_VOLUME_DUCK_RANGE_DB
}

/**
 * Ear-tuning: linear element gain for the LIVE bed preview that
 * matches what the export mix bakes at the same slider position. The editor
 * plays the voiceover-only render at unity, so applying the export's duck math
 * (bed->voice parity gain minus the volume-derived duck, same clamps) to the
 * raw bed element reproduces the exported balance. Volume 0 hard-mutes,
 * mirroring the voiceover-only delivery; gains above unity clip to 1 (an
 * HTMLAudioElement cannot boost) -- with parity at slider 100 any
 * quieter-than-voice bed clips there, so near full volume the preview can sit
 * a touch under the export (which may boost up to +6 dB). Callers without a
 * measured parity gain (bgmBedGainDb null) should keep the legacy linear
 * volume/100 curve.
 */
export function resolveBgmLiveBedGain(volume: number, bedToVoiceGainDb: number): number {
  const clamped = Math.max(0, Math.min(volume, 100))
  if (clamped === 0) {
    return 0
  }
  const gainDb = Math.min(
    BGM_GAIN_MAX_DB,
    Math.max(BGM_GAIN_MIN_DB, bedToVoiceGainDb - resolveBgmDuckDbForVolume(clamped)),
  )
  return Math.min(1, 10 ** (gainDb / 20))
}

/**
 * The music level as the volume controls show it: a plain percentage, where 100% is as
 * loud as the narration. No decibels: people read a percentage at a glance.
 */
export function describeBgmVolume(volume: number): string {
  return `${Math.round(Math.max(0, Math.min(volume, 100)))}%`
}
