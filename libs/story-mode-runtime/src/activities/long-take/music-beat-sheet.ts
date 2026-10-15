import type { TranscriptData } from '@shared/types/agent/transcript'

import { LONG_TAKE_BEAT_SHEET_PATH } from '../long-take-experts-analysis'

import { formatLogFields, logger, withActivityHeartbeat, withLongTakeContext } from './common'
import { type BeatGrid, buildMusicBeatSheet } from './music-pacing'
import { createLongTakeStorage } from './storage'

// Compact music context written alongside the beat sheet. The 'music' visual-script route reads it so
// the scene-writing LLM knows the song's genre + section structure (verse/chorus/energy) - not just
// the per-cut timing the beat sheet already encodes.
export const LONG_TAKE_MUSIC_CONTEXT_PATH = 'long_take/experts/music_context.json'

// Raw librosa beat grid (full beats / downbeats / onsets / energy curve / sections / bpm) persisted
// for eval + debugging. Not consumed downstream - the beat sheet + music context above carry
// what shot-plan and the visual-script prompt need; this is the analysis source of truth for a run.
export const LONG_TAKE_BEAT_GRID_PATH = 'long_take/experts/beat_grid.json'

export interface BuildLongTakeMusicBeatSheetActivityParams {
  beatGrid: BeatGrid
  musicGenre?: string
  projectId: string
  transcriptPath: string
  userId?: string
}

export interface BuildLongTakeMusicBeatSheetActivityResult {
  beatCount: number
  outputPath: string
}

export interface LongTakeMusicContext {
  bpm: number
  durationSec: number
  genre?: string
  sections: Array<{ end: number; label?: string; start: number }>
}

// Build a music-driven beat sheet from a BeatGrid (produced by analyzeMusicBeatGrid on the dedicated
// music-analysis queue) and persist it to the standard beat-sheet path, REPLACING the text-driven one
// for the music-video route. buildMusicBeatSheet sets time_range_audited:true, so shot-plan PATH A
// (buildShotsFromBeatTimeRanges) consumes it unchanged. Also writes a compact music context for the
// 'music' visual-script route. The cut structure (how many shots, where they land) is therefore
// decided by the music, and the visual script is generated 1:1 against it.
export async function buildLongTakeMusicBeatSheet(
  params: BuildLongTakeMusicBeatSheetActivityParams,
): Promise<BuildLongTakeMusicBeatSheetActivityResult> {
  const { beatGrid, musicGenre, projectId, transcriptPath, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir('long_take/experts')

      let transcript: null | TranscriptData = null
      try {
        transcript = await storage.readJsonFile<TranscriptData>(transcriptPath)
      } catch {
        // Instrumental / lyric-sparse tracks may have no usable transcript. The beat sheet still gets
        // its cuts from the music grid; segment_text just stays empty for those shots.
      }

      const beatSheet = buildMusicBeatSheet(beatGrid, transcript)

      const musicContext: LongTakeMusicContext = {
        bpm: beatGrid.bpm,
        durationSec: beatGrid.durationSec,
        genre: musicGenre,
        sections: beatGrid.sections.map((s) => ({ end: s.end, label: s.label, start: s.start })),
      }
      await storage.writeJsonFile(LONG_TAKE_MUSIC_CONTEXT_PATH, musicContext)

      // Persist the raw beat grid (energy curve, every detected beat/onset) for eval + debugging.
      await storage.writeJsonFile(LONG_TAKE_BEAT_GRID_PATH, beatGrid)

      // beat_sheet.json lives at the shared path the whole pipeline keys off (shot-plan PATH A,
      // the music visual-script route), so write it LAST -- a mid-activity failure must not leave
      // the timing artifact without its context -- and never persist an empty (unusable) sheet:
      // callers fall back to the text route on beatCount 0, and the UIP non-fast path has no
      // later stage that would overwrite a stale music beat sheet.
      if (beatSheet.beat_sheet.length > 0) {
        await storage.writeJsonFile(LONG_TAKE_BEAT_SHEET_PATH, beatSheet)
      }

      logger.info(
        `[long-take] Music beat sheet built ${formatLogFields({
          projectId,
          beatCount: beatSheet.beat_sheet.length,
          bpm: beatGrid.bpm,
          durationSec: beatGrid.durationSec,
          hasTranscript: Boolean(transcript),
          sectionCount: beatGrid.sections.length,
          durationMs: Date.now() - startedAt,
        })}`,
      )

      return { beatCount: beatSheet.beat_sheet.length, outputPath: LONG_TAKE_BEAT_SHEET_PATH }
    }),
  )
}

// Best-effort read of the music context persisted by buildLongTakeMusicBeatSheet. Returns null when
// absent (e.g. non-music route), so callers can fall back gracefully.
export async function readLongTakeMusicContext(
  storage: ReturnType<typeof createLongTakeStorage>,
): Promise<LongTakeMusicContext | null> {
  try {
    return await storage.readJsonFile<LongTakeMusicContext>(LONG_TAKE_MUSIC_CONTEXT_PATH)
  } catch {
    return null
  }
}
