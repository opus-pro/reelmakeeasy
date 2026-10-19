/**
 * Ranking Builder: a ranking short (9:16). A title band at the top, the ranks 1..N down the
 * left, and one clip per rank playing behind them; as each clip plays, its rank's label is
 * revealed and stays. Saved as JSON in the data folder; clips are stored files.
 */

/** One word (or phrase) of the title, in its own colour: the keywords stand out. */
export type RankingTitleWord = { color: string; text: string }

export type RankingTitle = {
  /** The band's colour behind the title (usually black). */
  band: string
  /** One to three lines, each a run of coloured words. */
  lines: RankingTitleWord[][]
}

/** A clip under a rank: a stored video, and the part of it that plays. */
export type RankingClip = {
  /** Length of the whole file, in seconds. */
  durationSec: number
  /** Its file name as uploaded, shown in the studio. */
  name: string
  trimEndSec: number
  trimStartSec: number
  /** `store://ranking/<projectId>/clips/<file>` (a served URL as it leaves for the browser). */
  url: string
}

export type RankingItem = {
  clip: null | RankingClip
  /** A short, stable id (the studio's React key and the render's file names). */
  id: string
  /** What is revealed next to the rank number, e.g. "Got bitten 😳". */
  label: string
  /** 1 is the top. */
  rank: number
}

/** The order the ranks are revealed in: N down to 1, 1 up to N, a fixed shuffle, or by hand. */
export type RankingRevealMode = 'countdown' | 'countup' | 'custom' | 'shuffle'

export type RankingStyle = {
  /** The label text's colour. */
  labelColor: string
  /** Rank number colours: 1, 2, 3, then everything else. */
  numberColors: [string, string, string, string]
  /** The outline around numbers and labels (keeps them readable over any clip). */
  outlineColor: string
}

export type RankingProject = {
  createdAt: string
  id: string
  items: RankingItem[]
  name: string
  reveal: { mode: RankingRevealMode; order: number[] }
  style: RankingStyle
  title: RankingTitle
  updatedAt: string
}

/** The fields the studio may change (`PUT /api/ranking/projects/:id`). */
export type RankingProjectPatch = Partial<
  Pick<RankingProject, 'items' | 'name' | 'reveal' | 'style' | 'title'>
>

/** `GET /api/ranking/projects`: the list, newest first. */
export type RankingProjectSummary = {
  id: string
  itemCount: number
  /** The latest render, when there is one. */
  lastRenderUrl: null | string
  name: string
  updatedAt: string
}

export type RankingRenderStatus = {
  error?: string
  /** 0..1 while rendering. */
  progress: number
  renderId: string
  state: 'done' | 'failed' | 'rendering'
  /** The finished video (a served URL), once done. */
  videoUrl?: string
}
