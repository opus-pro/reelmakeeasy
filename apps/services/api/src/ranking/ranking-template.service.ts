import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  RANKING_LABEL_MAX,
  RANKING_MAX_ITEMS,
  RANKING_MIN_ITEMS,
  RANKING_STICKER_TEXT_MAX,
} from '@reelmakeeasy/common/ranking/ranking-project'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import type {
  RankingTemplate,
  RankingTemplateInput,
  RankingTemplateSound,
  RankingTemplateSticker,
} from '@shared/types/api/ranking'

import type { SoundLibraryService } from '../sound-library/sound-library.service'

import {
  color,
  fraction,
  isRecord,
  parseStyle,
  parseTitle,
  parseTransition,
  RankingPatchError,
  REVEAL_MODES,
  round2,
  text,
} from './ranking-patch'

const TEMPLATE_ID = /^[\da-f-]{36}$/
const NOTES_MAX = 2000
const NAME_MAX = 80
const LINE_MAX = 200
const SOUND_DESCRIPTION_MAX = 120
const EXAMPLES_MAX = 8
const ACTION_SOUNDS_MAX = 8

export class RankingTemplateNotFoundError extends Error {}

function soundOf(v: unknown, soundExists: (id: string) => boolean, what: string): RankingTemplateSound {
  if (!isRecord(v)) throw new RankingPatchError(`${what} needs a description.`)
  const description = text(v['description'] ?? '', SOUND_DESCRIPTION_MAX, `${what}'s description`).trim()
  if (!description) throw new RankingPatchError(`Describe ${what} (e.g. "short low boom").`)
  const id = v['soundId']
  if (id === null || id === undefined || id === '') return { description, soundId: null }
  if (typeof id !== 'string' || !soundExists(id))
    throw new RankingPatchError(`${what}: that sound is not in the library (use null for one still to download).`)
  return { description, soundId: id }
}

const maybeSound = (v: unknown, soundExists: (id: string) => boolean, what: string) =>
  v === null || v === undefined ? null : soundOf(v, soundExists, what)

function stickerOf(v: unknown): RankingTemplateSticker {
  if (!isRecord(v)) throw new RankingPatchError('A sticker example is missing.')
  return {
    color: color(v['color'], 'A sticker example'),
    rotation: Math.round(fraction(v['rotation'] ?? 0, 'A sticker’s angle', -180, 180)),
    size: fraction(v['size'], 'A sticker’s size', 0.02, 1),
    text: text(v['text'] ?? '', RANKING_STICKER_TEXT_MAX, 'a sticker').trim(),
    x: fraction(v['x'], 'A sticker’s x'),
    y: fraction(v['y'], 'A sticker’s y'),
  }
}

function list<T>(v: unknown, max: number, what: string, each: (x: unknown) => T): T[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > max) throw new RankingPatchError(`${what}: at most ${max}.`)
  return v.map(each)
}

/** A whole style, checked; `soundExists` says whether a library sound id is real. */
export function parseTemplate(v: unknown, soundExists: (id: string) => boolean): RankingTemplateInput {
  if (!isRecord(v)) throw new RankingPatchError('The style is missing.')
  const name = text(v['name'] ?? '', NAME_MAX, 'the name').trim()
  if (!name) throw new RankingPatchError('Give the style a name.')
  const rankCount = Number(v['rankCount'])
  if (!Number.isInteger(rankCount) || rankCount < RANKING_MIN_ITEMS || rankCount > RANKING_MAX_ITEMS)
    throw new RankingPatchError(`A style has ${RANKING_MIN_ITEMS} to ${RANKING_MAX_ITEMS} ranks.`)
  const perRankSec = Number(v['perRankSec'])
  if (!Number.isFinite(perRankSec) || perRankSec < 1 || perRankSec > 20)
    throw new RankingPatchError('Seconds per rank is from 1 to 20.')
  const reveal = v['reveal']
  if (!REVEAL_MODES.includes(reveal as never)) throw new RankingPatchError('Pick a reveal order.')
  const labels = isRecord(v['labels']) ? v['labels'] : {}
  const stickers = isRecord(v['stickers']) ? v['stickers'] : {}
  if (!isRecord(v['sounds'])) throw new RankingPatchError('The style is missing its sound plan.')
  const sounds = v['sounds']
  const musicVolume = Number(sounds['musicVolume'] ?? 0.35)
  if (!Number.isFinite(musicVolume) || musicVolume < 0 || musicVolume > 1)
    throw new RankingPatchError('The music level is from 0 to 1.')
  let source: RankingTemplate['source'] = null
  if (isRecord(v['source']) && typeof v['source']['url'] === 'string') {
    const url = v['source']['url'].trim()
    if (!/^https:\/\/\S{1,500}$/.test(url)) throw new RankingPatchError('The source must be an https link.')
    const title = text(v['source']['title'] ?? '', LINE_MAX, 'the source title').trim()
    source = { url, ...(title ? { title } : {}) }
  }
  const { sound: _sound, texts: _texts, ...transition } = parseTransition({ ...(isRecord(v['transition']) ? v['transition'] : {}), sound: null }, () => false)
  return {
    labels: {
      examples: list(labels['examples'], EXAMPLES_MAX, 'Label examples', (x) => text(x, RANKING_LABEL_MAX, 'a label example').trim()),
      tone: text(labels['tone'] ?? '', LINE_MAX, 'the label tone').trim(),
    },
    name,
    notes: text(v['notes'] ?? '', NOTES_MAX, 'the notes').trim(),
    perRankSec: round2(perRankSec),
    rankCount,
    reveal: reveal as RankingTemplate['reveal'],
    sounds: {
      music: maybeSound(sounds['music'], soundExists, 'The music'),
      musicVolume: round2(musicVolume),
      onAction: list(sounds['onAction'], ACTION_SOUNDS_MAX, 'Action sounds', (x) => soundOf(x, soundExists, 'An action sound')),
      reveal: maybeSound(sounds['reveal'], soundExists, 'The reveal sound'),
      transition: maybeSound(sounds['transition'], soundExists, 'The transition sound'),
    },
    source,
    stickers: {
      examples: list(stickers['examples'], EXAMPLES_MAX, 'Sticker examples', stickerOf),
      habit: text(stickers['habit'] ?? '', LINE_MAX, 'the sticker habit').trim(),
    },
    style: parseStyle(v['style']),
    title: parseTitle(v['title']),
    transition,
  }
}

/**
 * Ranking styles (`RankingTemplate`), saved as JSON in `<DATA_DIR>/ranking-styles/`. A sound
 * deleted from the library since reads back as one to download (`soundId: null`).
 */
export class RankingTemplateService {
  constructor(
    private readonly sounds: null | Pick<SoundLibraryService, 'has'> = null,
    private readonly root: string = path.join(dataDir(), 'ranking-styles'),
  ) {
    fs.mkdirSync(this.root, { recursive: true })
  }

  list(): RankingTemplate[] {
    return fs
      .readdirSync(this.root)
      .filter((name) => name.endsWith('.json'))
      .map((name) => this.read(name.slice(0, -5)))
      .filter((t): t is RankingTemplate => t !== null)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  get(id: string): RankingTemplate {
    const template = this.read(id)
    if (!template) throw new RankingTemplateNotFoundError(`No ranking style ${id}`)
    return template
  }

  create(input: unknown): RankingTemplate {
    const now = new Date().toISOString()
    const template: RankingTemplate = { ...parseTemplate(input, this.exists), createdAt: now, id: randomUUID(), updatedAt: now }
    this.write(template)
    return template
  }

  /** Changes any part of a style (whole fields, as `get` shows them). */
  update(id: string, patch: unknown): RankingTemplate {
    const current = this.get(id)
    if (!isRecord(patch)) throw new RankingPatchError('Send the fields to change.')
    const { createdAt: _c, id: _i, updatedAt: _u, ...rest } = current
    const next: RankingTemplate = {
      ...parseTemplate({ ...rest, ...patch }, this.exists),
      createdAt: current.createdAt,
      id,
      updatedAt: new Date().toISOString(),
    }
    this.write(next)
    return next
  }

  delete(id: string): void {
    this.get(id)
    fs.rmSync(this.file(id), { force: true })
  }

  private readonly exists = (soundId: string) => this.sounds?.has(soundId) ?? false

  private file(id: string): string {
    return path.join(this.root, `${id}.json`)
  }

  private read(id: string): null | RankingTemplate {
    if (!TEMPLATE_ID.test(id)) return null
    try {
      const template = JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as RankingTemplate
      const live = (s: null | RankingTemplateSound) => (s?.soundId && !this.exists(s.soundId) ? { ...s, soundId: null } : s)
      const { sounds } = template
      return {
        ...template,
        sounds: {
          ...sounds,
          music: live(sounds.music),
          onAction: sounds.onAction.map((s) => live(s) as RankingTemplateSound),
          reveal: live(sounds.reveal),
          transition: live(sounds.transition),
        },
      }
    } catch {
      return null
    }
  }

  private write(template: RankingTemplate): void {
    const file = this.file(template.id)
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(template, null, 1)}\n`)
    fs.renameSync(`${file}.tmp`, file)
  }
}
