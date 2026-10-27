import fs from 'node:fs'
import path from 'node:path'

import { alignmentReport, analyseBeatGrid } from '@reelmakeeasy/common/motion-reel/beat-grid'
import { decodeAudioMono } from '@reelmakeeasy/common/motion-reel/decode-audio'
import type { MotionReelReference } from '@reelmakeeasy/common/motion-reel/reel-config'
import { normalizeBrandUrl } from '@reelmakeeasy/common/utils/normalize-brand-url'
import { validateOutboundUrl } from '@reelmakeeasy/common/utils/outbound-url'
import { chromium } from 'playwright'

import { motionReelDir, run, runtimeDir } from './motion-runtime'

/** Where a reel's reference files go: under `public/` so a scene may show a website's screenshots. */
export const REFERENCE_DIR = path.join('public', 'reference')

const YOUTUBE_HOSTS = new Set([
  'm.youtube.com',
  'music.youtube.com',
  'www.youtube.com',
  'youtu.be',
  'youtube.com',
])
/** How much of a reference video is read: its opening, which carries its style. */
const VIDEO_SECONDS = 90
const SHEET_FRAMES = 16
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export class BadReferenceError extends Error {}

/** A reference link as the setup card may send it: a public https page, or a YouTube video. */
export function checkReference(ref: MotionReelReference): MotionReelReference {
  if (ref.kind === 'youtube') {
    let url: URL
    try {
      url = new URL(ref.url.trim())
    } catch {
      throw new BadReferenceError("That isn't a YouTube link.")
    }
    if (url.protocol !== 'https:' || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase()))
      throw new BadReferenceError("That isn't a YouTube link.")
    return { kind: 'youtube', url: url.toString() }
  }
  try {
    return {
      kind: 'website',
      url: validateOutboundUrl(normalizeBrandUrl(ref.url.trim())).toString(),
    }
  } catch {
    throw new BadReferenceError(
      "That website address can't be opened (only public https:// sites).",
    )
  }
}

/**
 * Reads a reference into `<projectDir>/public/reference/`, for the agent to look at (it has no
 * web access itself). A website: three screenshots down its home page and `brand.json` (its
 * colours, fonts, headline). A video: `contact-sheet.png` (16 frames across its opening) and
 * `rhythm.json` (its cut times, its music's tempo, how many cuts land on its beat). Returns one
 * line saying what is there.
 */
export async function readReference(
  ref: MotionReelReference,
  projectDir: string,
  onProgress: (line: string) => void,
): Promise<string> {
  const dir = path.join(projectDir, REFERENCE_DIR)
  fs.rmSync(dir, { force: true, recursive: true })
  fs.mkdirSync(dir, { recursive: true })
  if (ref.kind === 'website') {
    onProgress('Looking at the website…')
    await readWebsite(ref.url, dir)
    return 'site-1.png to site-3.png (the home page, top to bottom) and brand.json'
  }
  onProgress('Watching the reference video…')
  await readVideo(ref.url, dir)
  return 'contact-sheet.png and rhythm.json'
}

async function readWebsite(url: string, dir: string): Promise<void> {
  const browser = await chromium.launch({
    args: ['--disable-dev-shm-usage'],
    executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] || remotionBrowserPath(),
    headless: true,
  })
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      userAgent: UA,
      viewport: { height: 900, width: 1440 },
    })
    await page.goto(url, { timeout: 30_000, waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)
    for (let i = 0; i < 3; i++) {
      await page.evaluate((y) => window.scrollTo(0, y), i * 900)
      await page.waitForTimeout(600)
      await page.screenshot({ path: path.join(dir, `site-${i + 1}.png`), timeout: 15_000 })
    }
    const brand = await page.evaluate(BRAND_SCRIPT)
    fs.writeFileSync(
      path.join(dir, 'brand.json'),
      `${JSON.stringify({ url, ...(brand as object) }, null, 1)}\n`,
    )
  } finally {
    await browser.close()
  }
}

/** Runs in the page: its title, headline, fonts and most used colours. */
const BRAND_SCRIPT = `(() => {
  const count = new Map()
  const add = (c, w) => { if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return; count.set(c, (count.get(c) || 0) + w) }
  for (const el of Array.from(document.querySelectorAll('body, body *')).slice(0, 4000)) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const s = getComputedStyle(el)
    add(s.backgroundColor, Math.min(r.width * r.height, 500000) / 1000)
    if (el.childNodes.length && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) add(s.color, 20)
  }
  const font = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontFamily : null }
  const meta = document.querySelector('meta[name="description"]')
  return {
    colors: Array.from(count.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]),
    description: meta ? meta.getAttribute('content') : null,
    fonts: { body: font('body'), heading: font('h1') || font('h2') },
    headline: (document.querySelector('h1') || {}).innerText || null,
    title: document.title,
  }
})()`

async function readVideo(url: string, dir: string): Promise<void> {
  const work = fs.mkdtempSync(path.join(motionReelDir(), 'ref-'))
  try {
    await run(
      await ytDlp(),
      [
        '--no-playlist',
        '--no-progress',
        '-f',
        'bv*[height<=720]+ba/b[height<=720]/b',
        '--merge-output-format',
        'mp4',
        '--download-sections',
        `*0-${VIDEO_SECONDS}`,
        '--max-filesize',
        '400M',
        '-o',
        'ref.%(ext)s',
        url,
      ],
      work,
      5 * 60_000,
    )
    const video = fs.readdirSync(work).find((name) => name.startsWith('ref.'))
    if (!video) throw new Error('the video could not be downloaded')
    const file = path.join(work, video)
    const duration =
      Number(
        (
          await run(
            'ffprobe',
            ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
            work,
          )
        ).trim(),
      ) || VIDEO_SECONDS
    await run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-i',
        file,
        '-vf',
        `fps=${SHEET_FRAMES / duration},scale=480:-2,tile=4x4:padding=6:color=black`,
        '-frames:v',
        '1',
        path.join(dir, 'contact-sheet.png'),
      ],
      work,
    )
    const cuts = await detectCuts(file, work)
    let music: null | { bpm: number; cutsOnBeat: string } = null
    try {
      const grid = analyseBeatGrid(await decodeAudioMono(file))
      const halfBeats = grid.beats.flatMap((b, i) => [
        b,
        (b + (grid.beats[i + 1] ?? b + 60 / grid.bpm)) / 2,
      ])
      const onBeat = alignmentReport(cuts, grid.beats, 0.06).onBeat
      const onHalf = alignmentReport(cuts, halfBeats, 0.06).onBeat
      music = {
        bpm: grid.bpm,
        cutsOnBeat: `${onBeat} of ${cuts.length} on a beat, ${onHalf} on a beat or half beat`,
      }
    } catch {
      // A silent video has no tempo; its cuts still say how fast it moves.
    }
    const gaps = cuts.slice(1).map((c, i) => c - (cuts[i] as number))
    fs.writeFileSync(
      path.join(dir, 'rhythm.json'),
      `${JSON.stringify(
        {
          cutTimesSec: cuts,
          cutsPerMinute: Math.round((cuts.length / duration) * 60),
          medianShotSec: gaps.length ? Math.round(median(gaps) * 100) / 100 : null,
          music,
          secondsRead: Math.round(duration),
          source: url,
        },
        null,
        1,
      )}\n`,
    )
  } finally {
    fs.rmSync(work, { force: true, recursive: true })
  }
}

/** Shot changes, by FFmpeg's scene score. */
export async function detectCuts(file: string, cwd: string, threshold = 0.3): Promise<number[]> {
  const out = await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      file,
      '-an',
      '-vf',
      `select='gt(scene,${threshold})',showinfo`,
      '-f',
      'null',
      '-',
    ],
    cwd,
    10 * 60_000,
    4_000_000,
  )
  return [...out.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000) / 1000)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/** The headless browser Remotion downloaded into the runtime (the same one that renders):
 *  `node_modules/.remotion/chrome-headless-shell/<platform>/<folder>/chrome-headless-shell`, beside
 *  a `VERSION` file. Undefined when it isn't there. */
export function remotionBrowserPath(root: string = runtimeDir()): string | undefined {
  const base = path.join(root, 'node_modules', '.remotion', 'chrome-headless-shell')
  const dirs = (dir: string) =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(dir, entry.name))
      : []
  for (const folder of dirs(base).flatMap(dirs)) {
    for (const name of ['chrome-headless-shell', 'chrome-headless-shell.exe']) {
      const file = path.join(folder, name)
      if (fs.existsSync(file)) return file
    }
  }
  return undefined
}

const YT_DLP_ASSET: Partial<Record<string, string>> = {
  'darwin-arm64': 'yt-dlp_macos',
  'darwin-x64': 'yt-dlp_macos',
  'linux-arm64': 'yt-dlp_linux_aarch64',
  'linux-x64': 'yt-dlp_linux',
  'win32-x64': 'yt-dlp.exe',
}

/** yt-dlp: the one on PATH, else its official release, downloaded once into the data folder. */
async function ytDlp(): Promise<string> {
  try {
    await run('yt-dlp', ['--version'], motionReelDir(), 15_000)
    return 'yt-dlp'
  } catch {
    // Not installed: use (or fetch) our own copy.
  }
  const asset = YT_DLP_ASSET[`${process.platform}-${process.arch}`]
  if (!asset)
    throw new Error(
      `yt-dlp isn't available for ${process.platform}-${process.arch}: install it to use video references`,
    )
  const file = path.join(motionReelDir(), 'bin', asset === 'yt-dlp.exe' ? asset : 'yt-dlp')
  if (!fs.existsSync(file)) {
    const response = await fetch(
      `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`,
    )
    if (!response.ok) throw new Error(`yt-dlp download failed (${response.status})`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(`${file}.tmp`, Buffer.from(await response.arrayBuffer()))
    // yt-dlp's release is a single executable: it must be runnable by its owner.
    // eslint-disable-next-line sonarjs/file-permissions -- our own copy, in the data folder
    fs.chmodSync(`${file}.tmp`, 0o755)
    fs.renameSync(`${file}.tmp`, file)
  }
  return file
}
