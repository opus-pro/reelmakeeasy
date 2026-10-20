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

/** A sound that plays at a moment of a rank's clip (a meme sound on the action). */
export type RankingCue = {
  /** Seconds from the start of the rank's clip as it plays (after its trim). */
  atSec: number
  id: string
  soundId: string
}

/**
 * Text, an emoji or a picture placed on the frame: over the whole short, or only while one rank
 * plays. Positions are fractions of the 1080x1920 frame, at the sticker's centre.
 */
export type RankingSticker = {
  /** Text colour (text stickers). */
  color: string
  id: string
  /** A stored picture's address (picture stickers); a served URL as it leaves for the browser. */
  imageUrl?: string
  kind: 'image' | 'text'
  /** Only while this rank plays; null: the whole short. */
  rank: null | number
  /** Degrees, clockwise. */
  rotation: number
  /** Text: its height as a fraction of the frame's height. Picture: its width as a fraction of the frame's width. */
  size: number
  /** Text or emoji (text stickers). */
  text?: string
  x: number
  y: number
}

export type RankingItem = {
  clip: null | RankingClip
  /** Sounds at moments of this rank's clip (missing: none). */
  cues?: RankingCue[]
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

/** The sounds of a ranking short, by sound-library id (null: none). */
export type RankingSounds = {
  /** A track under the whole short, looped to fit. */
  music: null | string
  /** Its level, 0..1, under the clips' own sound. */
  musicVolume: number
  /** Plays as each rank's clip starts. */
  reveal: null | string
}

/** A slide between ranks (rank N's clip, the slide, rank N+1's clip). */
export type RankingTransition = {
  background: string
  durationSec: number
  enabled: boolean
  /** Plays as the slide starts. */
  sound: null | string
  /** Shown big and centred; `{rank}` is the next rank's number. */
  text: string
  textColor: string
}

export type RankingProject = {
  createdAt: string
  id: string
  items: RankingItem[]
  name: string
  reveal: { mode: RankingRevealMode; order: number[] }
  /** Missing on projects saved before sounds existed: no sounds. */
  sounds?: RankingSounds
  /** Text, emoji and pictures on the frame (missing: none). */
  stickers?: RankingSticker[]
  style: RankingStyle
  title: RankingTitle
  /** Missing on projects saved before transitions existed: none. */
  transition?: RankingTransition
  updatedAt: string
}

/** The fields the studio may change (`PUT /api/ranking/projects/:id`). */
export type RankingProjectPatch = Partial<
  Pick<
    RankingProject,
    'items' | 'name' | 'reveal' | 'sounds' | 'stickers' | 'style' | 'title' | 'transition'
  >
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
