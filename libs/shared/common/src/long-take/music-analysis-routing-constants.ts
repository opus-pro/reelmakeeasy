// Dedicated task queue for the music-analysis worker (librosa beat-grid extraction).
//
// Defined here in @reelmakeeasy/common so that BOTH the music-analysis service (which registers the worker
// on this queue) and story-mode-runtime (whose long-take workflow dispatches analyzeMusicBeatGrid to
// it) reference one source of truth, without story-mode-runtime taking a libs -> apps dependency on
// apps/services/music-analysis. The workflow uses this bare literal; the
// service layers a MUSIC_ANALYSIS_TASK_QUEUE env override on top for dev/worktree isolation.
export const MUSIC_ANALYSIS_BASE_TASK_QUEUE = 'music-analysis'
