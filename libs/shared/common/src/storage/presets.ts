import fs from 'node:fs'
import path from 'node:path'

import { checkStoreKey, filesBaseUrl, isPresetUri, isStoreKey, PRESET_SCHEME } from './address'
import { dataDir } from './file-store'

const PRESETS_DIR_NAME = 'presets'

/** Render inputs in the preset pack (built by `scripts/build-preset-pack.mjs`). */
export const RENDER_PRESETS = {
  fonts: 'render/fonts.tar.gz',
  templateSnapshot: 'render/current_template_snapshot.json',
} as const

let cached: string | undefined
let cachedPackVersion: string | undefined

/**
 * The repo's `presets/` folder of bundled static files, found by walking up from
 * the working directory (the API runs from `apps/services/api` in dev and from
 * the repo root when built).
 */
export function presetsDir(): string {
  if (cached) return cached
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, PRESETS_DIR_NAME)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      cached = candidate
      return candidate
    }
    if (path.dirname(dir) === dir) {
      throw new Error(`No ${PRESETS_DIR_NAME}/ folder found above ${process.cwd()}`)
    }
  }
}

/** The preset pack version `presets/pack.json` pins, e.g. `v001`. */
export function presetPackVersion(): string {
  cachedPackVersion ??= (
    JSON.parse(fs.readFileSync(path.join(presetsDir(), 'pack.json'), 'utf8')) as { version: string }
  ).version
  return cachedPackVersion
}

/** Where `pnpm reelmakeeasy setup` unpacks the preset pack. */
export function presetPackDir(): string {
  return path.join(dataDir(), PRESETS_DIR_NAME, presetPackVersion())
}

/** A `file://` URI for a file in the installed preset pack, for server-side readers. */
export function presetPackFileUri(key: string): string {
  return `file://${resolveWithin(presetPackDir(), key)}`
}

function resolveWithin(root: string, key: string): string {
  const file = path.resolve(root, key)
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`Invalid preset path: ${key}`)
  return file
}

/** Absolute path of a file in `presets/`, rejecting keys that escape the folder. */
export function presetPath(key: string): string {
  return resolveWithin(presetsDir(), key)
}

/**
 * A served preset key: `<pack version>/<path>` lives in the installed pack and
 * never changes; anything else lives in the repo's `presets/`. `file` is
 * relative to `root`, as `res.sendFile` wants it (it hides any absolute path
 * with a dot segment, and the pack lives under `.reelmakeeasy`).
 */
export function resolvePresetKey(key: string): { file: string; immutable: boolean; root: string } {
  const [first, ...rest] = key.split('/')
  const inPack = first === presetPackVersion() && rest.length > 0
  const root = inPack ? presetPackDir() : presetsDir()
  const file = resolveWithin(root, inPack ? rest.join('/') : key)
  return { file: path.relative(root, file), immutable: inPack, root }
}

const presetsBaseUrl = () => filesBaseUrl().replace(/\/files$/, '/presets')
const encodePath = (key: string) => key.split('/').map(encodeURIComponent).join('/')

/** URL browsers load a file in the repo's `presets/` from. */
export function presetUrl(key: string): string {
  return `${presetsBaseUrl()}/${encodePath(key)}`
}

/** URL browsers load a file in the preset pack from. */
export function presetPackUrl(key: string): string {
  return `${presetsBaseUrl()}/${presetPackVersion()}/${encodePath(key)}`
}

/**
 * The address saved data keeps for a file in the preset pack, `preset://<pack version>/<path>`:
 * no host or port, served as `presetPackUrl` gives it when the data leaves for the browser
 * (`serveStoredUrls`). A key that leaves the pack throws.
 */
export function presetPackUri(key: string): string {
  return `${PRESET_SCHEME}${checkStoreKey(`${presetPackVersion()}/${key}`).replace(/%/g, '%25')}`
}

/** The local file behind a `preset://<key>` address (see `resolvePresetKey`). */
export function presetFilePath(uri: string): string {
  if (!isPresetUri(uri)) throw new Error(`Not a preset address: ${uri}`)
  const key = decodeURIComponent(uri.slice(PRESET_SCHEME.length))
  if (!isStoreKey(key)) throw new Error(`Invalid preset path: ${key}`)
  const { file, root } = resolvePresetKey(key)
  return path.join(root, file)
}
