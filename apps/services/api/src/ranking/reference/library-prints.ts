import { decodeAudioMono, SOUND_ANALYSIS_RATE } from '@reelmakeeasy/common/audio/decode-audio'
import { type LibraryPrint, printOfSound, spectrogram } from '@reelmakeeasy/common/audio/sound-analysis'

import type { SoundLibraryService } from '../../sound-library/sound-library.service'

/** Seconds of each library sound read for its fingerprint (its start is what matters). */
const READ_SEC = 2

/**
 * Fingerprints of the user's library sounds, from where each plays (its trim start), cached
 * by id and trim: a re-trimmed sound is read again.
 */
export class LibraryPrints {
  private readonly cache = new Map<string, LibraryPrint | null>()

  constructor(private readonly sounds: Pick<SoundLibraryService, 'list' | 'playback'>) {}

  async all(): Promise<LibraryPrint[]> {
    const out: LibraryPrint[] = []
    for (const sound of this.sounds.list()) {
      const playback = this.sounds.playback(sound.id)
      const key = `${sound.id}:${playback.startSec}:${playback.endSec}`
      if (!this.cache.has(key)) {
        try {
          const samples = await decodeAudioMono(playback.file, SOUND_ANALYSIS_RATE, playback.startSec + READ_SEC)
          const from = Math.floor(playback.startSec * SOUND_ANALYSIS_RATE)
          const to = Math.floor(Math.min(playback.endSec, playback.startSec + READ_SEC) * SOUND_ANALYSIS_RATE)
          const print = printOfSound(spectrogram(samples.subarray(from, to)))
          this.cache.set(key, print ? { id: sound.id, name: sound.name, print } : null)
        } catch {
          this.cache.set(key, null)
        }
      }
      const print = this.cache.get(key)
      if (print) out.push({ ...print, name: sound.name })
    }
    return out
  }
}
