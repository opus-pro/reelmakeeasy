import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { presetPackDir, RENDER_PRESETS } from '../../storage/presets'

import {
  CAPTION_PACK_FAMILIES,
  CAPTION_PACK_FONTS,
  captionFontSizeFactor,
  captionPackFace,
  MONTSERRAT_CAP_HEIGHT,
  RENDER_FONTS_ARCHIVE,
  renderFontsArchiveUrl,
  snapCaptionFontWeight,
} from './caption-fonts'
import { captionFontFile } from './caption-painter'

/** The file names of the render font pack (presets render/fonts.tar.gz, unchanged since v006). */
const PACK_FILES = [
  'Alegreya-Black.ttf',
  'Alegreya-Bold.ttf',
  'Alegreya-ExtraBold.ttf',
  'Alegreya-Medium.ttf',
  'Alegreya-Regular.ttf',
  'Alegreya-SemiBold.ttf',
  'Anton-Regular.ttf',
  'DMSans-Bold.ttf',
  'DMSans-BoldItalic.ttf',
  'DMSans-Italic.ttf',
  'DMSans-Medium.ttf',
  'DMSans-MediumItalic.ttf',
  'DMSans-Regular.ttf',
  'Dela Gothic One.ttf',
  'DelaGothicOne-Regular.ttf',
  'Inter.ttf',
  'Montserrat-Black.ttf',
  'Montserrat-BlackItalic.ttf',
  'Montserrat-Bold.ttf',
  'Montserrat-BoldItalic.ttf',
  'Montserrat-ExtraBold.ttf',
  'Montserrat-ExtraLight.ttf',
  'Montserrat-Light.ttf',
  'PTSerif-Bold.ttf',
  'PTSerif-BoldItalic.ttf',
  'PTSerif-Italic.ttf',
  'PTSerif-Regular.ttf',
  'Roboto-Black.ttf',
  'Roboto-Bold.ttf',
  'Roboto-Light.ttf',
  'Roboto-Medium.ttf',
  'Roboto-Regular.ttf',
  'Roboto-SemiBold.ttf',
  'RobotoSerif-Medium.ttf',
  'RobotoSerif-Regular.ttf',
  'RobotoSerif-SemiBold.ttf',
]

describe('snapCaptionFontWeight', () => {
  it('takes the nearest weight the family has, the heavier one on a tie', () => {
    expect(snapCaptionFontWeight([400], 900)).toBe(400)
    expect(snapCaptionFontWeight([400, 500, 700], 900)).toBe(700)
    expect(snapCaptionFontWeight([400, 500, 600], 700)).toBe(600)
    expect(snapCaptionFontWeight([300, 400, 500, 600, 700, 900], 800)).toBe(900)
    expect(snapCaptionFontWeight([400, 700], 550)).toBe(700)
    expect(snapCaptionFontWeight([400, 700], 700)).toBe(700)
  })
})

describe('captionPackFace', () => {
  // Punch and Classic ask for 900, Explainer for 700.
  it.each([
    ['Alegreya', 900, 'Alegreya-Black.ttf'],
    ['Alegreya', 700, 'Alegreya-Bold.ttf'],
    ['Anton', 900, 'Anton-Regular.ttf'],
    ['Anton', 700, 'Anton-Regular.ttf'],
    ['DM Sans', 900, 'DMSans-Bold.ttf'],
    ['Dela Gothic One', 900, 'DelaGothicOne-Regular.ttf'],
    ['PT Serif', 900, 'PTSerif-Bold.ttf'],
    ['Roboto', 900, 'Roboto-Black.ttf'],
    ['Roboto', 700, 'Roboto-Bold.ttf'],
    ['Roboto Serif', 900, 'RobotoSerif-SemiBold.ttf'],
  ] as const)('%s asked for %i draws %s', (family, weight, file) => {
    expect(captionPackFace(family, weight).file).toBe(file)
  })

  it('names the face the export painter picks from the pack for every weight it can draw', () => {
    for (const family of CAPTION_PACK_FAMILIES) {
      for (const target of [100, 400, 700, 900]) {
        const face = captionPackFace(family, target)
        expect(captionFontFile(PACK_FILES, { family, italic: false, weight: face.weight })).toEqual(
          { file: face.file, italic: false, weight: face.weight },
        )
      }
    }
  })
})

describe('captionFontSizeFactor', () => {
  it('leaves Montserrat exactly as it is', () => {
    expect(captionFontSizeFactor(MONTSERRAT_CAP_HEIGHT)).toBe(1)
  })

  it('evens out capital height, within 0.8 to 1.15', () => {
    expect(captionFontSizeFactor(CAPTION_PACK_FONTS.Anton.capHeight)).toBeCloseTo(0.8145, 4)
    expect(captionFontSizeFactor(CAPTION_PACK_FONTS.Alegreya.capHeight)).toBeCloseTo(1.0989, 4)
    expect(captionFontSizeFactor(CAPTION_PACK_FONTS['DM Sans'].capHeight)).toBe(1)
    expect(captionFontSizeFactor(0.5)).toBe(1.15)
    expect(captionFontSizeFactor(1)).toBe(0.8)
  })

  it('leaves a face of unknown capital height as it is', () => {
    expect(captionFontSizeFactor(null)).toBe(1)
    expect(captionFontSizeFactor(0)).toBe(1)
  })
})

describe('renderFontsArchiveUrl', () => {
  it('is the render pack archive under the served preset pack', () => {
    expect(RENDER_FONTS_ARCHIVE).toBe(RENDER_PRESETS.fonts)
    expect(renderFontsArchiveUrl('http://localhost:5017/api/presets/v007')).toBe(
      'http://localhost:5017/api/presets/v007/render/fonts.tar.gz',
    )
    expect(renderFontsArchiveUrl('http://localhost:5017/api/presets/v007/')).toBe(
      'http://localhost:5017/api/presets/v007/render/fonts.tar.gz',
    )
  })
})

// The render font pack is installed by `pnpm reelmakeeasy setup`; without it this is skipped.
const fontArchive = (() => {
  try {
    return path.join(presetPackDir(), RENDER_PRESETS.fonts)
  } catch {
    return undefined
  }
})()
const describeWithFontPack = fontArchive && fs.existsSync(fontArchive) ? describe : describe.skip

/** OS/2 usWeightClass and sCapHeight / unitsPerEm of a TrueType file. */
function readFaceMetrics(file: string): { capHeight: number; weight: number } {
  const b = fs.readFileSync(file)
  const tables = new Map<string, number>()
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const at = 12 + i * 16
    tables.set(b.toString('latin1', at, at + 4), b.readUInt32BE(at + 8))
  }
  const head = tables.get('head') as number
  const os2 = tables.get('OS/2') as number
  return {
    capHeight: b.readInt16BE(os2 + 88) / b.readUInt16BE(head + 18),
    weight: b.readUInt16BE(os2 + 4),
  }
}

describeWithFontPack('the caption font table against the installed render pack', () => {
  let fontsDir: string
  let workDir: string
  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-font-table-'))
    execFileSync('tar', ['-xzf', fontArchive as string, '-C', workDir])
    fontsDir = path.join(workDir, 'fonts')
  })
  afterAll(() => fs.rmSync(workDir, { force: true, recursive: true }))

  it("measures Montserrat's capital height as the table says", () => {
    expect(readFaceMetrics(path.join(fontsDir, 'Montserrat-Black.ttf')).capHeight).toBeCloseTo(
      MONTSERRAT_CAP_HEIGHT,
      4,
    )
  })

  it.each(CAPTION_PACK_FAMILIES)('has every %s face, weight and capital height', (family) => {
    const font = CAPTION_PACK_FONTS[family]
    for (const face of font.faces) {
      const metrics = readFaceMetrics(path.join(fontsDir, face.file))
      expect(metrics.weight).toBe(face.weight)
      expect(metrics.capHeight).toBeCloseTo(font.capHeight, 4)
    }
    // The table lists every upright face of the family in the pack.
    const upright = fs
      .readdirSync(fontsDir)
      .filter((file) => captionFontFile([file], { family, italic: false, weight: 400 }))
      .filter((file) => !/italic/i.test(file) && file !== 'Dela Gothic One.ttf')
    expect(font.faces.map((f) => f.file).sort()).toEqual(upright.sort())
  })
})
