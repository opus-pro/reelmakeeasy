import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  CAPTION_PACK_FAMILIES,
  CAPTION_PACK_FONTS,
  captionPackFace,
} from '@reelmakeeasy/common/adapters/caption/caption-fonts'
import { filesBaseUrl } from '@reelmakeeasy/common/storage/address'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import {
  presetPackDir,
  presetPackVersion,
  RENDER_PRESETS,
} from '@reelmakeeasy/common/storage/presets'
import { Injectable } from '@nestjs/common'
import type { CaptionPackFontInfo } from '@shared/types/api/caption-style'

const run = promisify(execFile)

/** The weight a picker sample shows: Punch's and Classic's, snapped to one the family has. */
const SAMPLE_WEIGHT = 900

/** Montserrat's heavy faces, from the same pack: the default caption font, which the Ranking
 *  Builder draws its titles, numbers and labels in. */
const MONTSERRAT_FACES = ['Montserrat-ExtraBold.ttf', 'Montserrat-Black.ttf']

/** Every face file of the pack families (and Montserrat's heavy faces), the only names the pack
 *  route serves. */
const PACK_FONT_FILES: ReadonlySet<string> = new Set([
  ...Object.values(CAPTION_PACK_FONTS).flatMap((font) => font.faces.map((face) => face.file)),
  ...MONTSERRAT_FACES,
])

/**
 * The caption fonts the app offers, and their faces for the browser's picker samples. The faces
 * are unpacked on demand from the installed render font pack into the same per-version cache the
 * loop finish draws from (`<data>/cache/render-fonts/<pack version>/`).
 */
@Injectable()
export class CaptionFontsService {
  private readonly unpacking = new Map<string, Promise<void>>()

  /** Whether the pack route serves `file`: a face of a pack family, by its exact name. */
  isPackFontFile(file: string): boolean {
    return PACK_FONT_FILES.has(file)
  }

  /** The render pack families, in the picker's order, with a sample face each. */
  listPack(): CaptionPackFontInfo[] {
    const base = filesBaseUrl().replace(/\/files$/, '/caption-fonts/pack')
    const version = encodeURIComponent(presetPackVersion())
    return CAPTION_PACK_FAMILIES.map((family) => ({
      family,
      // The pack version in the query: a new pack gets new URLs, so they can be cached for good.
      sampleUrl: `${base}/${encodeURIComponent(captionPackFace(family, SAMPLE_WEIGHT).file)}?v=${version}`,
      weights: CAPTION_PACK_FONTS[family].faces.map((face) => face.weight),
    }))
  }

  /**
   * The folder holding pack face `file`, unpacked from the render font pack first if needed.
   * Undefined when it isn't a pack family's face, or the pack isn't installed.
   */
  async packFontDir(file: string): Promise<string | undefined> {
    if (!this.isPackFontFile(file)) return undefined
    const dir = path.join(dataDir(), 'cache', 'render-fonts', presetPackVersion())
    if (fs.existsSync(path.join(dir, file))) return dir
    const archive = path.join(presetPackDir(), RENDER_PRESETS.fonts)
    if (!fs.existsSync(archive)) return undefined
    let pending = this.unpacking.get(file)
    if (!pending) {
      pending = unpackFace(archive, file, dir).finally(() => this.unpacking.delete(file))
      this.unpacking.set(file, pending)
    }
    try {
      await pending
    } catch {
      return undefined
    }
    return fs.existsSync(path.join(dir, file)) ? dir : undefined
  }
}

/** Unpacks one face from the pack's `fonts/` into `dir`, moved in whole once unpacked. */
async function unpackFace(archive: string, file: string, dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
  const staging = await fs.promises.mkdtemp(path.join(dir, '.unpack-'))
  try {
    await run('tar', ['-xzf', archive, '-C', staging, `fonts/${file}`])
    await fs.promises.rename(path.join(staging, 'fonts', file), path.join(dir, file))
  } finally {
    await fs.promises.rm(staging, { force: true, recursive: true })
  }
}
