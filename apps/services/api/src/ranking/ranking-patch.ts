import {
  isPermutation,
  RANKING_CLIP_MAX_SEC,
  RANKING_LABEL_MAX,
  RANKING_MAX_ITEMS,
  RANKING_MIN_ITEMS,
  RANKING_TITLE_LINES_MAX,
  RANKING_TITLE_WORDS_MAX,
  RANKING_TRANSITION_MAX_SEC,
  RANKING_TRANSITION_MIN_SEC,
  RANKING_TRANSITION_TEXT_MAX,
  revealOrder,
} from '@reelmakeeasy/common/ranking/ranking-project'
import { toSavedAddress } from '@reelmakeeasy/common/storage/address'
import type {
  RankingClip,
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
const REVEAL_MODES: RankingRevealMode[] = ['countdown', 'countup', 'custom', 'shuffle']
const NAME_MAX = 80
const WORD_MAX = 40
const ITEM_ID = /^[\w-]{1,40}$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function color(v: unknown, what: string): string {
  if (typeof v !== 'string' || !HEX.test(v)) throw new RankingPatchError(`${what} must be a colour like #ff2a2a.`)
  return v.toLowerCase()
}

function text(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string') throw new RankingPatchError(`${what} must be text.`)
  const t = v.replace(/\s+/g, ' ')
  if (t.length > max) throw new RankingPatchError(`Keep ${what} under ${max} characters.`)
  return t
}

function parseTitle(v: unknown): RankingTitle {
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

function parseStyle(v: unknown): RankingStyle {
  if (!isRecord(v) || !Array.isArray(v['numberColors']) || v['numberColors'].length !== 4)
    throw new RankingPatchError('The style needs four number colours.')
  const [a, b, c, d] = (v['numberColors'] as unknown[]).map((x) => color(x, 'A number'))
  return {
    labelColor: color(v['labelColor'], 'The label'),
    numberColors: [a as string, b as string, c as string, d as string],
    outlineColor: color(v['outlineColor'], 'The outline'),
  }
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

const round2 = (n: number) => Math.round(n * 100) / 100

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

function parseTransition(v: unknown, soundExists: (id: string) => boolean): RankingTransition {
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
  }
}

function parseItems(v: unknown, current: RankingProject): RankingItem[] {
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
    return {
      clip: parseClip(raw['clip'] ?? null, known),
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
  if ('items' in patch) next.items = parseItems(patch['items'], current)
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
