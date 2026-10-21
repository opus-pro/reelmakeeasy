/**
 * Ranking Builder: a ranking short (9:16). A title band at the top, the ranks 1..N down the
 * left, and one clip per rank playing behind them; as each clip plays, its rank's label is
 * revealed and stays. Saved as JSON in the data folder; clips are stored files.
 */

/**
 * The fonts the overlay can draw with (from the render font pack): `montserrat` (heavy sans, the
 * trend's default), `anton` (tall condensed), `dela` (chunky, poster-like), `roboto`,
 * `alegreya` (bold serif), `dmsans` (rounded sans), `ptserif`.
 */
export type RankingFontId = 'alegreya' | 'anton' | 'dela' | 'dmsans' | 'montserrat' | 'ptserif' | 'roboto'

/** How a sticker comes in, moves while shown, and goes. */
export type RankingStickerAnimation = {
  in: 'fade' | 'none' | 'pop' | 'slide-down' | 'slide-left' | 'slide-right' | 'slide-up'
  /** `shake` is the vibrate: a fast jitter. */
  loop: 'float' | 'none' | 'pulse' | 'shake'
  out: 'fade' | 'none' | 'pop'
}

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
  /** How it comes in, moves and goes (missing: it just shows). */
  animation?: RankingStickerAnimation
  /** Text colour (text stickers). */
  color: string
  /** Seconds after its rank's clip starts (or the short starts, for the whole short) that it
   *  goes; null or missing: until the end. */
  endSec?: null | number
  /** Text stickers' font (missing: the labels' font). */
  font?: RankingFontId
  id: string
  /** A stored picture's address (picture stickers); a served URL as it leaves for the browser. */
  imageUrl?: string
  /** Text stickers: slanted, like comic lettering. */
  italic?: boolean
  kind: 'image' | 'text'
  /** Only while this rank plays; null: the whole short. */
  rank: null | number
  /** Degrees, clockwise. */
  rotation: number
  /** Text: its height as a fraction of the frame's height. Picture: its width as a fraction of the frame's width. */
  size: number
  /** Seconds after its rank's clip starts (or the short starts, for the whole short) that it
   *  shows; missing: 0. */
  startSec?: number
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

/** How each rank is marked: `1.`, `#1`, `1`, a keycap emoji (1️⃣), medals for the top three
 *  (🥇🥈🥉, then `4.`), or `custom` (`numberMarks`, one per rank: any text or emoji). */
export type RankingNumberFormat = 'custom' | 'dot' | 'hash' | 'keycap' | 'medal' | 'plain'

export type RankingStyle = {
  /** The label text's colour. */
  labelColor: string
  /** Fonts per part (missing: Montserrat). */
  labelFont?: RankingFontId
  /** Rank number colours: 1, 2, 3, then everything else. */
  numberColors: [string, string, string, string]
  numberFont?: RankingFontId
  /** Missing: `dot`. */
  numberFormat?: RankingNumberFormat
  /** With `custom`: the mark of rank 1, 2, ... (a missing one falls back to `N.`). */
  numberMarks?: string[]
  /** The outline around numbers and labels (keeps them readable over any clip). */
  outlineColor: string
  titleFont?: RankingFontId
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
  /** The slide text's font (missing: the title's). */
  font?: RankingFontId
  /** Plays as the slide starts. */
  sound: null | string
  /** Shown big on every slide; `{rank}` is the next rank's number. */
  text: string
  textColor: string
  /**
   * A slide's own text, by the rank it leads into (`"3"`: the slide before #3), in place of
   * `text` (`{rank}` works here too; empty: a blank slide). Missing: every slide shows `text`.
   */
  texts?: Record<string, string>
  /** The slide text's size, as a share of the frame's height (missing: 0.078); text too wide
   *  for the frame shrinks to fit. */
  textSize?: number
  /** Where the slide text's middle is, as fractions of the frame (missing: 0.5, the middle). */
  textX?: number
  textY?: number
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
  /** What the ranking looks like now, as a key: a cover is made for it (`POST .../cover`). */
  coverKey: string
  /** The cover is missing or shows an older version of the ranking: draw it again. */
  coverStale: boolean
  /** Its cover (the short at its payoff, 360x640), when one was drawn. */
  coverUrl: null | string
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

/** One sound in a ranking style's plan: what it is, and the library sound that plays it. */
export type RankingTemplateSound = {
  /** In words a person can search for, e.g. "short low boom (vine boom)". */
  description: string
  /** A sound-library id; null: not in the library yet (the user downloads one). */
  soundId: null | string
}

/** A sticker a style tends to use (text or emoji), placed as a fraction of the frame. */
export type RankingTemplateSticker = Pick<RankingSticker, 'color' | 'rotation' | 'size' | 'text' | 'x' | 'y'>

/**
 * A ranking style (shown as a "style"): the pattern of a kind of ranking short, learned from a
 * reference video or written by hand, that any ranking can take on. Saved as JSON in the data
 * folder; sounds are sound-library ids.
 */
export type RankingTemplate = {
  createdAt: string
  id: string
  /** How its labels read: their tone and a few examples. */
  labels: { examples: string[]; tone: string }
  name: string
  /** What makes it work, for the agent and the user (plain text, a few lines). */
  notes: string
  /** About how long each rank plays, in seconds. */
  perRankSec: number
  rankCount: number
  reveal: RankingRevealMode
  sounds: {
    music: null | RankingTemplateSound
    musicVolume: number
    /** The sounds that go on each clip's action (the agent picks the one that fits). */
    onAction: RankingTemplateSound[]
    /** On each clip's start. */
    reveal: null | RankingTemplateSound
    /** On each transition slide. */
    transition: null | RankingTemplateSound
  }
  /** The video it was learned from, if any. */
  source: null | { title?: string; url: string }
  stickers: { examples: RankingTemplateSticker[]; habit: string }
  style: RankingStyle
  /** The title's look: band colour and coloured words (its text is an example). */
  title: RankingTitle
  /** The transition slide, without its sound (that is `sounds.transition`) or one slide's own
   *  text (those belong to a ranking). */
  transition: Omit<RankingTransition, 'sound' | 'texts'>
  updatedAt: string
}

/** What a style is saved from (`POST /api/ranking/styles`); `PUT` takes any part of it. */
export type RankingTemplateInput = Omit<RankingTemplate, 'createdAt' | 'id' | 'updatedAt'>
