import {
  isPermutation,
  RANKING_CLIP_MAX_SEC,
  RANKING_CUES_MAX,
  RANKING_STICKER_TEXT_MAX,
  RANKING_STICKERS_MAX,
  RANKING_LABEL_MAX,
  RANKING_MAX_ITEMS,
  RANKING_MIN_ITEMS,
  RANKING_SHORT_MAX_SEC,
  RANKING_TITLE_LINES_MAX,
  RANKING_TITLE_WORDS_MAX,
  RANKING_TRANSITION_MAX_SEC,
  RANKING_TRANSITION_MIN_SEC,
  pruneSlideTexts,
  RANKING_TRANSITION_TEXT_MAX,
  revealOrder,
} from '@reelmakeeasy/common/ranking/ranking-project'
import { STICKER_INS, STICKER_LOOPS, STICKER_OUTS } from '@reelmakeeasy/common/ranking/ranking-motion'
import { isRankingFontId, RANKING_FONT_IDS, RANKING_NUMBER_MARK_MAX } from '@reelmakeeasy/common/ranking/ranking-type'
import { keyIsUnder, parseStoreUri, toSavedAddress } from '@reelmakeeasy/common/storage/address'
import type {
  RankingClip,
  RankingCue,
  RankingFontId,
  RankingNumberFormat,
  RankingSticker,
  RankingItem,
  RankingProject,
  RankingRevealMode,
  RankingSounds,
  RankingStyle,
  RankingTitle,
  RankingTransition,
} from '@shared/types/api/ranking'

/** A studio edit the API can't take; the message says what to fix. */
export class RankingPatchError extends Error {}

const HEX = /^#[\da-f]{6}$/i
export const REVEAL_MODES: RankingRevealMode[] = ['countdown', 'countup', 'custom', 'shuffle']
const NAME_MAX = 80
const WORD_MAX = 40
const ITEM_ID = /^[\w-]{1,40}$/

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function color(v: unknown, what: string): string {
  if (typeof v !== 'string' || !HEX.test(v)) throw new RankingPatchError(`${what} must be a colour like #ff2a2a.`)
  return v.toLowerCase()
}

export function text(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string') throw new RankingPatchError(`${what} must be text.`)
  const t = v.replace(/\s+/g, ' ')
  if (t.length > max) throw new RankingPatchError(`Keep ${what} under ${max} characters.`)
  return t
}

export function parseTitle(v: unknown): RankingTitle {
  if (!isRecord(v) || !Array.isArray(v['lines'])) throw new RankingPatchError('The title is missing its lines.')
  const lines = v['lines'] as unknown[]
  if (lines.length < 1 || lines.length > RANKING_TITLE_LINES_MAX)
    throw new RankingPatchError(`The title has 1 to ${RANKING_TITLE_LINES_MAX} lines.`)
  return {
    band: color(v['band'], 'The title band'),
    lines: lines.map((line) => {
      if (!Array.isArray(line) || line.length > RANKING_TITLE_WORDS_MAX)
        throw new RankingPatchError(`A title line has at most ${RANKING_TITLE_WORDS_MAX} words.`)
      return line.map((word) => {
        if (!isRecord(word)) throw new RankingPatchError('A title word is missing.')
        return { color: color(word['color'], 'A title word'), text: text(word['text'], WORD_MAX, 'a title word') }
      })
    }),
  }
}

export function parseStyle(v: unknown): RankingStyle {
  if (!isRecord(v) || !Array.isArray(v['numberColors']) || v['numberColors'].length !== 4)
    throw new RankingPatchError('The style needs four number colours.')
  const [a, b, c, d] = (v['numberColors'] as unknown[]).map((x) => color(x, 'A number'))
  const style: RankingStyle = {
    labelColor: color(v['labelColor'], 'The label'),
    numberColors: [a as string, b as string, c as string, d as string],
    outlineColor: color(v['outlineColor'], 'The outline'),
  }
  for (const key of ['labelFont', 'numberFont', 'titleFont'] as const) {
    const font = optionalFont(v[key])
    if (font) style[key] = font
  }
  const format = v['numberFormat']
  if (format !== undefined && format !== null) {
    if (!NUMBER_FORMATS.includes(format as never))
      throw new RankingPatchError(`The rank marks are one of ${NUMBER_FORMATS.join(', ')}.`)
    style.numberFormat = format as RankingNumberFormat
  }
  if (style.numberFormat === 'custom') {
    const marks = v['numberMarks']
    if (!Array.isArray(marks) || marks.length > RANKING_MAX_ITEMS)
      throw new RankingPatchError(`Custom rank marks are a list, one per rank (at most ${RANKING_MAX_ITEMS}).`)
    style.numberMarks = marks.map((m) => text(m ?? '', RANKING_NUMBER_MARK_MAX, 'a rank mark').trim())
  }
  return style
}

const NUMBER_FORMATS: RankingNumberFormat[] = ['custom', 'dot', 'hash', 'keycap', 'medal', 'plain']

/** A font choice: a pack font's id, or none (the default). */
function optionalFont(v: unknown): RankingFontId | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (!isRankingFontId(v)) throw new RankingPatchError(`Fonts are one of ${RANKING_FONT_IDS.join(', ')}.`)
  return v
}

/** A sticker's timing and animation, checked; only what differs from "always, still" is kept. */
function parseStickerMotion(raw: Record<string, unknown>, sticker: RankingSticker): void {
  const start = raw['startSec']
  if (start !== undefined && start !== null && Number(start) !== 0)
    sticker.startSec = fraction(start, 'A sticker’s start', 0, RANKING_SHORT_MAX_SEC)
  const end = raw['endSec']
  if (end !== undefined && end !== null) {
    sticker.endSec = fraction(end, 'A sticker’s end', 0, RANKING_SHORT_MAX_SEC)
    if (sticker.endSec <= (sticker.startSec ?? 0)) throw new RankingPatchError('A sticker must end after it starts.')
  }
  const anim = raw['animation']
  if (anim === undefined || anim === null) return
  if (!isRecord(anim)) throw new RankingPatchError('A sticker’s animation is { in, loop, out }.')
  const pick = <T extends string>(value: unknown, options: T[], what: string): T => {
    const v = value ?? 'none'
    if (!options.includes(v as T)) throw new RankingPatchError(`A sticker’s ${what} is one of ${options.join(', ')}.`)
    return v as T
  }
  const animation = {
    in: pick(anim['in'], STICKER_INS, 'entrance'),
    loop: pick(anim['loop'], STICKER_LOOPS, 'loop'),
    out: pick(anim['out'], STICKER_OUTS, 'exit'),
  }
  if (animation.in !== 'none' || animation.loop !== 'none' || animation.out !== 'none') sticker.animation = animation
}

/** A clip as the studio sends it back: only one the project already has (by url), re-trimmed. */
function parseClip(v: unknown, known: Map<string, RankingClip>): null | RankingClip {
  if (v === null) return null
  if (!isRecord(v) || typeof v['url'] !== 'string') throw new RankingPatchError('A clip is missing.')
  // The studio sends back the served URL; the project keeps the file's address.
  const saved = known.get(toSavedAddress(v['url']))
  if (!saved) throw new RankingPatchError('Upload a clip before using it.')
  const start = Number(v['trimStartSec'])
  const end = Number(v['trimEndSec'])
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > saved.durationSec + 0.05)
    throw new RankingPatchError(`Trim "${saved.name}" inside its ${saved.durationSec.toFixed(1)} s.`)
  if (end - start > RANKING_CLIP_MAX_SEC + 0.05)
    throw new RankingPatchError(`A clip plays at most ${RANKING_CLIP_MAX_SEC} s.`)
  return { ...saved, trimEndSec: round2(end), trimStartSec: round2(start) }
}

export const round2 = (n: number) => Math.round(n * 100) / 100

/** A sound choice: a library sound's id, or null for none. */
function soundId(v: unknown, soundExists: (id: string) => boolean): null | string {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !soundExists(v)) throw new RankingPatchError('That sound is no longer in your library.')
  return v
}

function parseSounds(v: unknown, soundExists: (id: string) => boolean): RankingSounds {
  if (!isRecord(v)) throw new RankingPatchError('The sounds are missing.')
  const volume = Number(v['musicVolume'])
  if (!Number.isFinite(volume) || volume < 0 || volume > 1)
    throw new RankingPatchError('The music level is from 0 to 100%.')
  return {
    music: soundId(v['music'], soundExists),
    musicVolume: round2(volume),
    reveal: soundId(v['reveal'], soundExists),
  }
}

export function parseTransition(v: unknown, soundExists: (id: string) => boolean): RankingTransition {
  if (!isRecord(v)) throw new RankingPatchError('The transition is missing.')
  const durationSec = Number(v['durationSec'])
  if (!Number.isFinite(durationSec) || durationSec < RANKING_TRANSITION_MIN_SEC || durationSec > RANKING_TRANSITION_MAX_SEC)
    throw new RankingPatchError(
      `A transition lasts ${RANKING_TRANSITION_MIN_SEC} to ${RANKING_TRANSITION_MAX_SEC} s.`,
    )
  return {
    background: color(v['background'], 'The transition background'),
    durationSec: round2(durationSec),
    enabled: v['enabled'] === true,
    sound: soundId(v['sound'], soundExists),
    text: text(v['text'] ?? '', RANKING_TRANSITION_TEXT_MAX, 'the transition text'),
    textColor: color(v['textColor'], 'The transition text'),
    ...parseSlideTexts(v['texts']),
  }
}

/** Single slides' own texts, by the rank each leads into (missing or empty: none). */
function parseSlideTexts(v: unknown): { texts?: Record<string, string> } {
  if (v === undefined || v === null) return {}
  if (!isRecord(v)) throw new RankingPatchError('The slide texts must be an object, by rank.')
  const texts: Record<string, string> = {}
  for (const [rank, value] of Object.entries(v)) {
    const n = Number(rank)
    if (!Number.isInteger(n) || n < 1 || n > RANKING_MAX_ITEMS || String(n) !== rank)
      throw new RankingPatchError(`A slide's text is keyed by the rank it leads into (1-${RANKING_MAX_ITEMS}).`)
    texts[rank] = text(value, RANKING_TRANSITION_TEXT_MAX, `the text of the slide into #${rank}`)
  }
  return Object.keys(texts).length ? { texts } : {}
}

/** A rank's sound cues: library sounds, at moments inside the clip as it plays. */
function parseCues(v: unknown, clip: null | RankingClip, soundExists: (id: string) => boolean): RankingCue[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > RANKING_CUES_MAX)
    throw new RankingPatchError(`A rank has at most ${RANKING_CUES_MAX} sounds.`)
  const playSec = clip ? clip.trimEndSec - clip.trimStartSec : 0
  return v.map((raw, i) => {
    if (!isRecord(raw)) throw new RankingPatchError('A sound cue is missing.')
    const soundId = typeof raw['soundId'] === 'string' ? raw['soundId'] : ''
    if (!soundExists(soundId)) throw new RankingPatchError('That sound is no longer in your library.')
    const atSec = Number(raw['atSec'])
    if (!Number.isFinite(atSec) || atSec < 0 || (clip && atSec > playSec + 0.05))
      throw new RankingPatchError(`Put each sound inside its clip (0 to ${playSec.toFixed(1)} s).`)
    const id = typeof raw['id'] === 'string' && ITEM_ID.test(raw['id']) ? raw['id'] : `c${i}`
    return { atSec: round2(atSec), id, soundId }
  })
}

export const fraction = (v: unknown, what: string, min = 0, max = 1) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) throw new RankingPatchError(`${what} is out of range.`)
  return Math.round(n * 1000) / 1000
}

/**
 * Stickers: text or emoji, or a picture uploaded to this project (its address must be under
 * `ranking/<projectId>/stickers/`). Ranks they belong to must exist.
 */
function parseStickers(v: unknown, project: RankingProject): RankingSticker[] {
  if (!Array.isArray(v) || v.length > RANKING_STICKERS_MAX)
    throw new RankingPatchError(`A short has at most ${RANKING_STICKERS_MAX} stickers.`)
  const ranks = new Set(project.items.map((item) => item.rank))
  const ids = new Set<string>()
  return v.map((raw) => {
    if (!isRecord(raw)) throw new RankingPatchError('A sticker is missing.')
    const id = typeof raw['id'] === 'string' && ITEM_ID.test(raw['id']) ? raw['id'] : ''
    if (!id || ids.has(id)) throw new RankingPatchError('Each sticker needs its own id.')
    ids.add(id)
    const kind = raw['kind'] === 'image' ? 'image' : 'text'
    const rank = raw['rank'] === null || raw['rank'] === undefined ? null : Number(raw['rank'])
    if (rank !== null && !ranks.has(rank)) throw new RankingPatchError('A sticker belongs to a rank that is gone.')
    const sticker: RankingSticker = {
      color: kind === 'text' ? color(raw['color'], 'A sticker') : '#ffffff',
      id,
      kind,
      rank,
      rotation: fraction(raw['rotation'] ?? 0, 'A sticker’s rotation', -180, 180),
      size: fraction(raw['size'], 'A sticker’s size', 0.02, 1),
      x: fraction(raw['x'], 'A sticker’s position'),
      y: fraction(raw['y'], 'A sticker’s position'),
    }
    parseStickerMotion(raw, sticker)
    if (kind === 'text') {
      const t = text(raw['text'] ?? '', RANKING_STICKER_TEXT_MAX, 'a sticker').trim()
      if (!t) throw new RankingPatchError('A text sticker needs its text.')
      sticker.text = t
      const font = optionalFont(raw['font'])
      if (font) sticker.font = font
      if (raw['italic'] === true) sticker.italic = true
      return sticker
    }
    const address = typeof raw['imageUrl'] === 'string' ? toSavedAddress(raw['imageUrl']) : ''
    let key = ''
    try {
      key = parseStoreUri(address)
    } catch {
      // Refused below.
    }
    if (!key || !keyIsUnder(key, `ranking/${project.id}/stickers`))
      throw new RankingPatchError('Upload the picture before placing it.')
    sticker.imageUrl = address
    return sticker
  })
}

function parseItems(
  v: unknown,
  current: RankingProject,
  soundExists: (id: string) => boolean,
): RankingItem[] {
  if (!Array.isArray(v) || v.length < RANKING_MIN_ITEMS || v.length > RANKING_MAX_ITEMS)
    throw new RankingPatchError(`A ranking has ${RANKING_MIN_ITEMS} to ${RANKING_MAX_ITEMS} ranks.`)
  // Clips are known by the url of any version of this project's items (a clip moved to
  // another rank keeps its file).
  const known = new Map<string, RankingClip>()
  for (const item of current.items) if (item.clip) known.set(item.clip.url, item.clip)
  const ids = new Set<string>()
  return v.map((raw, i) => {
    if (!isRecord(raw)) throw new RankingPatchError('A rank is missing.')
    const id = typeof raw['id'] === 'string' && ITEM_ID.test(raw['id']) ? raw['id'] : ''
    if (!id || ids.has(id)) throw new RankingPatchError('Each rank needs its own id.')
    ids.add(id)
    const clip = parseClip(raw['clip'] ?? null, known)
    const cues = parseCues(raw['cues'], clip, soundExists)
    return {
      clip,
      ...(cues.length ? { cues } : {}),
      id,
      label: text(raw['label'] ?? '', RANKING_LABEL_MAX, 'a label'),
      // Ranks are their position: 1..N top to bottom.
      rank: i + 1,
    }
  })
}

/**
 * A studio edit applied to a project, checked field by field: colours are hex, text is short,
 * ranks are 1..N, clips are ones the project uploaded, the reveal order covers every rank.
 */
export function applyRankingPatch(
  current: RankingProject,
  patch: unknown,
  now: string,
  soundExists: (id: string) => boolean = () => true,
): RankingProject {
  if (!isRecord(patch)) throw new RankingPatchError('Nothing to change.')
  const next: RankingProject = { ...current, updatedAt: now }
  if ('name' in patch) {
    const name = text(patch['name'], NAME_MAX, 'the name').trim()
    next.name = name || current.name
  }
  if ('title' in patch) next.title = parseTitle(patch['title'])
  if ('style' in patch) next.style = parseStyle(patch['style'])
  if ('sounds' in patch) next.sounds = parseSounds(patch['sounds'], soundExists)
  if ('transition' in patch) next.transition = parseTransition(patch['transition'], soundExists)
  if ('items' in patch) next.items = parseItems(patch['items'], current, soundExists)
  // Fewer ranks: the own texts of slides into ranks that are gone go with them.
  if (next.transition) next.transition = pruneSlideTexts(next.transition, next.items.length)
  if ('stickers' in patch) next.stickers = parseStickers(patch['stickers'], next)
  if ('reveal' in patch || 'items' in patch) {
    const raw = isRecord(patch['reveal']) ? patch['reveal'] : current.reveal
    const mode = REVEAL_MODES.includes(raw['mode'] as RankingRevealMode)
      ? (raw['mode'] as RankingRevealMode)
      : current.reveal.mode
    const order = Array.isArray(raw['order']) ? (raw['order'] as number[]) : current.reveal.order
    const count = next.items.length
    next.reveal = {
      mode,
      // A custom or shuffled order the studio sent is kept when it covers every rank; otherwise
      // the mode makes one.
      order:
        (mode === 'custom' || mode === 'shuffle') && isPermutation(order, count)
          ? order
          : revealOrder(mode, count),
    }
  }
  return next
}
