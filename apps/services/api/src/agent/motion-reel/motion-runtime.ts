import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { Logger } from '@reelmakeeasy/common/logger'
import { encodeWav, SFX_NAMES, synthesiseSfx } from '@reelmakeeasy/common/motion-reel/sfx'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

/**
 * Motion Reel's shared runtime on this computer, installed on first use and kept in the data folder:
 * Remotion and its packages (never a dependency of ReelMakeEasy itself: Remotion has its own licence,
 * free for individuals and companies of up to 3 people), its headless browser, Remotion's agent skills,
 * and the synthesised sound pack. Every reel's project links to it, so a new reel installs nothing.
 */

const logger = new Logger('MotionReelRuntime')

/** Remotion's version the runtime installs; bump with care (the template and skill follow it). */
export const REMOTION_VERSION = '4.0.536'

/** Where Remotion's agent skills come from (downloaded on first use; they are not part of this repo). */
export const REMOTION_SKILLS_REPO = 'remotion-dev/skills'

export function motionReelDir(root: string = dataDir()): string {
  return path.join(root, 'motion-reel')
}
export const runtimeDir = (root?: string) => path.join(motionReelDir(root), 'runtime')
export const sfxDir = (root?: string) => path.join(motionReelDir(root), 'sfx')
export const remotionSkillsDir = (root?: string) =>
  path.join(motionReelDir(root), 'remotion-skills')

/** The runtime's package.json: Remotion and the packages a reel or an animation may use. */
export function runtimePackageJson(): string {
  const remotion = (name: string) => [name, REMOTION_VERSION] as const
  const dependencies = Object.fromEntries([
    remotion('remotion'),
    remotion('@remotion/cli'),
    remotion('@remotion/transitions'),
    remotion('@remotion/shapes'),
    remotion('@remotion/paths'),
    remotion('@remotion/noise'),
    remotion('@remotion/layout-utils'),
    remotion('@remotion/google-fonts'),
    // Claude Animation's 3D and 8-bit looks draw with three.js.
    remotion('@remotion/three'),
    ['@react-three/fiber', '9.8.1'],
    ['three', '0.186.1'],
    ['react', '19.2.0'],
    ['react-dom', '19.2.0'],
  ])
  return `${JSON.stringify(
    {
      dependencies,
      devDependencies: { '@types/react': '19.2.2', '@types/three': '0.186.0', typescript: '5.9.3' },
      name: 'reelmakeeasy-motion-reel-runtime',
      private: true,
      version: '1.0.0',
    },
    null,
    2,
  )}\n`
}

let installing: null | Promise<void> = null

/**
 * Makes sure the runtime is ready: packages installed, the headless browser downloaded, the sound
 * pack written and Remotion's skills present. Idempotent and shared: concurrent callers wait for the
 * same install. `onProgress` gets short, user-facing lines.
 */
export function ensureMotionReelRuntime(
  onProgress: (line: string) => void = () => undefined,
): Promise<void> {
  installing ??= installRuntime(onProgress).finally(() => {
    installing = null
  })
  return installing
}

async function installRuntime(onProgress: (line: string) => void): Promise<void> {
  const dir = runtimeDir()
  fs.mkdirSync(dir, { recursive: true })
  writeSfxPack()

  const manifest = path.join(dir, 'package.json')
  const wanted = runtimePackageJson()
  const current = fs.existsSync(manifest) ? fs.readFileSync(manifest, 'utf8') : ''
  const installed = fs.existsSync(path.join(dir, 'node_modules', 'remotion', 'package.json'))
  if (current !== wanted || !installed) {
    onProgress(
      'Installing Remotion on this computer (first time only, about a minute). Remotion is free for individuals and companies of up to 3 people; bigger companies need its company license (https://www.remotion.dev/license).',
    )
    fs.writeFileSync(manifest, wanted)
    await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir)
  }

  const browserMarker = path.join(dir, '.browser-ready')
  if (!fs.existsSync(browserMarker)) {
    onProgress('Downloading the browser Remotion renders with (first time only)…')
    await run(npxBin(), ['remotion', 'browser', 'ensure'], dir)
    fs.writeFileSync(browserMarker, new Date().toISOString())
  }

  await ensureRemotionSkills(onProgress)
}

/** Writes the synthesised sound effects once (they never change for a given name). */
export function writeSfxPack(dir: string = sfxDir()): void {
  fs.mkdirSync(dir, { recursive: true })
  for (const name of SFX_NAMES) {
    const file = path.join(dir, `${name}.wav`)
    if (!fs.existsSync(file)) fs.writeFileSync(file, encodeWav(synthesiseSfx(name)))
  }
}

/**
 * Downloads Remotion's agent skills into the data folder (a shallow clone; a failed download is
 * logged and skipped: reels still build without them).
 */
async function ensureRemotionSkills(onProgress: (line: string) => void): Promise<void> {
  const dir = remotionSkillsDir()
  if (fs.existsSync(path.join(dir, 'skills'))) return
  onProgress("Getting Remotion's agent skills (first time only)…")
  try {
    fs.rmSync(dir, { force: true, recursive: true })
    await run(
      'git',
      ['clone', '--depth', '1', `https://github.com/${REMOTION_SKILLS_REPO}.git`, dir],
      motionReelDir(),
    )
  } catch (error) {
    logger.warn(`Remotion skills not downloaded: ${ensureError(error).message}`)
  }
}

/** The skill folders downloaded from Remotion (name -> folder), empty when they aren't there. */
export function remotionSkillFolders(): { dir: string; name: string }[] {
  const root = path.join(remotionSkillsDir(), 'skills')
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md')),
    )
    .map((entry) => ({ dir: path.join(root, entry.name), name: entry.name }))
}

const npxBin = () => (process.platform === 'win32' ? 'npx.cmd' : 'npx')

/** Runs a command to completion; rejects with the end of its output when it fails. Resolves
 *  with the last `keepChars` of its output (stdout and stderr together). */
export function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 10 * 60_000,
  keepChars = 8000,
  extraEnv: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = command === 'npm' && process.platform === 'win32' ? 'npm.cmd' : command
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-keepChars)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else
        reject(
          new Error(`${command} ${args.join(' ')} failed (${code}): ${output.trim().slice(-1500)}`),
        )
    })
  })
}
