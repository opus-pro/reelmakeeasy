import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'

import {
  checkStoreKey,
  isStoreUri,
  parseStoreUri,
  storeKeyToUrl,
  storeUri,
  type StoreUri,
} from './address'

/**
 * Stored files on the local disk. The file with key `<key>` (address
 * `store://<key>`) lives at `<data dir>/files/<key>`, and its metadata in a sidecar
 * at `<data dir>/files-meta/<key>.json`, outside the served folder. The API serves
 * `<data dir>/files` at `/api/files/<key>`.
 */

/** `DATA_DIR`; `.reelmakeeasy` by default. */
export function dataDir(): string {
  return path.resolve(
    process.env['DATA_DIR'] || '.reelmakeeasy',
  )
}

/** The folder of stored files; the only folder the files route serves. */
export function filesRoot(): string {
  return path.join(dataDir(), 'files')
}

/** Sidecar metadata, and temp files mid-write: never inside the served folder. */
function filesMetaRoot(): string {
  return path.join(dataDir(), 'files-meta')
}

/** The key of a `store://` address, or of a key given as is; checked either way. */
export function storeKey(keyOrUri: string): string {
  return isStoreUri(keyOrUri) ? parseStoreUri(keyOrUri) : checkStoreKey(keyOrUri)
}

/**
 * The local path of a stored file, from its address or key. The one containment
 * guard: a key that is empty, hidden, or would leave `filesRoot()` throws, and so
 * does one that leaves it through a link (see `checkNoLinkOut`).
 */
export function filePath(keyOrUri: string): string {
  const root = filesRoot()
  const full = path.resolve(root, storeKey(keyOrUri))
  if (!full.startsWith(root + path.sep)) throw new Error(`Invalid stored file key: ${keyOrUri}`)
  checkNoLinkOut(full, root, keyOrUri)
  return full
}

/**
 * Throws when `full` resolves, through a link, outside the stored files. A project
 * folder is linked into the agent's working folder, so the agent can put a link
 * there; following it must never reach the signing key, the run records or
 * anything else on disk. A link that stays inside is followed, and the files
 * folder may itself be a link (a data dir on another disk). A missing path is
 * checked by its nearest folder that exists; a link to nothing is refused, since
 * a write would follow it out.
 */
function checkNoLinkOut(full: string, root: string, keyOrUri: string): void {
  let realRoot: string
  try {
    realRoot = fs.realpathSync.native(root)
  } catch {
    return // No stored files yet: nothing to follow.
  }
  const refuse = () => new Error(`Stored file leaves the files folder: ${keyOrUri}`)
  for (let probe = full; probe !== root; probe = path.dirname(probe)) {
    let real: string
    try {
      real = fs.realpathSync.native(probe)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw refuse()
      if (isLink(probe)) throw refuse()
      continue
    }
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw refuse()
    return
  }
}

function isLink(file: string): boolean {
  try {
    return fs.lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

function metaPath(key: string): string {
  return path.join(filesMetaRoot(), `${key}.json`)
}

let signingKey: Buffer | undefined

/** Secret for signed upload URLs: from env, else generated once and kept in the data dir. */
function getSigningKey(): Buffer {
  if (signingKey) return signingKey
  const fromEnv =
    process.env['FILE_SIGNING_SECRET']
  if (fromEnv) return (signingKey = Buffer.from(fromEnv))
  const keyFile = path.join(dataDir(), 'file-signing.key')
  if (fs.existsSync(keyFile)) return (signingKey = fs.readFileSync(keyFile))
  fs.mkdirSync(dataDir(), { recursive: true })
  const key = randomBytes(32)
  fs.writeFileSync(keyFile, key, { mode: 0o600 })
  return (signingKey = key)
}

function signature(key: string, action: string, expires: number): string {
  return createHmac('sha256', getSigningKey()).update(`${key}\n${action}\n${expires}`).digest('hex')
}

/** Whether `sig` is a live signature for uploading to `key`. */
export function verifyUploadSignature(params: {
  action?: string
  expires: number
  key: string
  sig: string
}): boolean {
  if (!Number.isFinite(params.expires) || params.expires < Date.now()) return false
  const expected = Buffer.from(signature(params.key, params.action ?? 'write', params.expires))
  const actual = Buffer.from(params.sig)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Thrown by a write whose `ifVersionMatch` no longer holds: someone wrote the file first. */
export class VersionConflictError extends Error {
  readonly code = 412
  constructor(key: string) {
    super(`Stored file changed since it was read: ${key}`)
    this.name = 'VersionConflictError'
  }
}

export function isVersionConflictError(error: unknown): boolean {
  return error instanceof VersionConflictError || (error as { code?: unknown } | null)?.code === 412
}

function notFound(key: string): Error {
  // "No such object" and code 404 are what isMissingObjectError recognises.
  return Object.assign(new Error(`No such object: ${key}`), { code: 404 })
}

/**
 * Writes `data` to `target` whole: into a temp file first (outside the served
 * folder, so it is never listed), then renamed over the target. A reader, or a
 * crash part way, never sees half a file, which matters for the records a run
 * reads back (a loop's paid takes, for one).
 */
async function writeWhole(target: string, data: Buffer | string | Uint8Array): Promise<void> {
  const tempDir = path.join(filesMetaRoot(), '.tmp')
  await mkdir(tempDir, { recursive: true })
  const temp = path.join(tempDir, `${randomBytes(8).toString('hex')}-${path.basename(target)}`)
  try {
    await writeFile(temp, data)
    await rename(temp, target).catch(async (err: NodeJS.ErrnoException) => {
      // The data dir spans two disks: no atomic rename between them.
      if (err.code !== 'EXDEV') throw err
      await writeFile(target, data)
    })
  } finally {
    await rm(temp, { force: true })
  }
}

/** Writes to one key wait for each other, so a version check and its write are one step. */
const keyLocks = new Map<string, Promise<unknown>>()

async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(key) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  const settled = run.catch(() => undefined)
  keyLocks.set(key, settled)
  try {
    return await run
  } finally {
    if (keyLocks.get(key) === settled) keyLocks.delete(key)
  }
}

const MIME: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.srt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}

export function contentTypeFor(key: string): string {
  return MIME[path.extname(key).toLowerCase()] ?? 'application/octet-stream'
}

/** What a sidecar keeps: the type a file was written with, and caller-defined fields. */
export interface FileMetadata {
  contentType?: string
  metadata?: Record<string, string>
}

export interface WriteOptions extends FileMetadata {
  /**
   * Write only if the file is still at this version (from `stat().version`), or,
   * with `0`, only if it does not exist yet. A mismatch throws VersionConflictError.
   */
  ifVersionMatch?: 0 | string
}

export interface FileInfo {
  contentType: string
  created: string
  /** Caller-defined fields set with the file. */
  custom: Record<string, string>
  size: number
  updated: string
  /** Changes on every write: pass it as `ifVersionMatch` to write only over what was read. */
  version: string
}

export class StoredFile {
  readonly key: string

  constructor(keyOrUri: string) {
    this.key = storeKey(keyOrUri)
  }

  get uri(): StoreUri {
    return storeUri(this.key)
  }

  /** The local path; checked against leaving the stored files. */
  get path(): string {
    return filePath(this.key)
  }

  async exists(): Promise<boolean> {
    try {
      return (await stat(this.path)).isFile()
    } catch {
      return false
    }
  }

  /** The bytes, or `start`..`end` (inclusive) of them. Throws a 404 error when missing. */
  async read(range?: { end?: number; start?: number }): Promise<Buffer> {
    const whole = await readFile(this.path).catch((err: NodeJS.ErrnoException) => {
      throw err.code === 'ENOENT' ? notFound(this.key) : err
    })
    return range
      ? whole.subarray(range.start ?? 0, range.end === undefined ? undefined : range.end + 1)
      : whole
  }

  /** Copies the file to a local path (creating its folder). */
  async readTo(destination: string): Promise<void> {
    const data = await this.read()
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, data)
  }

  async write(data: Buffer | string | Uint8Array, options: WriteOptions = {}): Promise<void> {
    const { ifVersionMatch, ...metadata } = options
    const put = async () => {
      if (ifVersionMatch !== undefined) await this.checkVersion(ifVersionMatch)
      await mkdir(path.dirname(this.path), { recursive: true })
      await writeWhole(this.path, data)
      await this.writeMeta(
        { ...metadata, contentType: metadata.contentType ?? contentTypeFor(this.key) },
        true,
      )
    }
    await (ifVersionMatch === undefined ? put() : withKeyLock(this.key, put))
  }

  /** Creates the file unless it exists; false when it already did (nothing is written). */
  async writeIfAbsent(
    data: Buffer | string | Uint8Array,
    options: FileMetadata = {},
  ): Promise<boolean> {
    try {
      await this.write(data, { ...options, ifVersionMatch: 0 })
      return true
    } catch (error) {
      if (isVersionConflictError(error)) return false
      throw error
    }
  }

  createReadStream(): Readable {
    return fs.createReadStream(this.path)
  }

  /**
   * A stream that writes the file. It finishes only once the bytes and the metadata sidecar
   * are both on disk, and a failed sidecar write fails the stream (it used to run on its own
   * after 'finish', where its error went unhandled).
   */
  createWriteStream(options: FileMetadata = {}): Writable {
    fs.mkdirSync(path.dirname(this.path), { recursive: true })
    const file = fs.createWriteStream(this.path)
    const meta = { ...options, contentType: options.contentType ?? contentTypeFor(this.key) }
    const stream = new Writable({
      destroy: (error, callback) => {
        file.destroy(error ?? undefined)
        callback(error)
      },
      final: (callback) => {
        file.end()
        finished(file)
          .then(() => this.writeMeta(meta, true))
          .then(() => callback(), callback)
      },
      write: (chunk: Buffer, encoding, callback) => {
        file.write(chunk, encoding, callback)
      },
    })
    file.on('error', (error) => stream.destroy(error))
    return stream
  }

  async stat(): Promise<FileInfo> {
    const info = await stat(this.path, { bigint: true }).catch((err: NodeJS.ErrnoException) => {
      throw err.code === 'ENOENT' ? notFound(this.key) : err
    })
    const sidecar = await this.readMeta()
    return {
      contentType: sidecar.contentType ?? contentTypeFor(this.key),
      created: new Date(Number(info.birthtimeMs)).toISOString(),
      custom: sidecar.metadata ?? {},
      size: Number(info.size),
      updated: new Date(Number(info.mtimeMs)).toISOString(),
      // The write time in nanoseconds: newer writes have larger versions.
      version: String(info.mtimeNs),
    }
  }

  /** Merges into the sidecar: `metadata` fields are added to the ones already set. */
  async setMetadata(update: FileMetadata): Promise<void> {
    await this.writeMeta(update, false)
  }

  async copyTo(destination: StoredFile | string): Promise<StoredFile> {
    const target = typeof destination === 'string' ? new StoredFile(destination) : destination
    const meta = await this.readMeta()
    await target.write(await this.read(), meta)
    return target
  }

  async delete(options: { ignoreNotFound?: boolean } = {}): Promise<void> {
    if (!options.ignoreNotFound && !(await this.exists())) throw notFound(this.key)
    await rm(this.path, { force: true })
    await rm(metaPath(this.key), { force: true })
  }

  /** The URL a browser loads the file from. */
  url(): string {
    return storeKeyToUrl(this.key)
  }

  /** A URL a browser may PUT the file's bytes to until it expires. */
  signedUploadUrl(expiresInMs = 15 * 60 * 1000): { expiresAt: string; signedUrl: string } {
    const expires = Date.now() + expiresInMs
    const query = new URLSearchParams({
      expires: String(expires),
      sig: signature(this.key, 'write', expires),
    })
    return {
      expiresAt: new Date(expires).toISOString(),
      signedUrl: `${this.url()}?${query.toString()}`,
    }
  }

  private async checkVersion(expected: 0 | string): Promise<void> {
    const current = (await this.exists()) ? (await this.stat()).version : 0
    if (current !== expected) throw new VersionConflictError(this.key)
  }

  private async readMeta(): Promise<FileMetadata> {
    try {
      return JSON.parse(await readFile(metaPath(this.key), 'utf8')) as FileMetadata
    } catch {
      return {}
    }
  }

  private async writeMeta(update: FileMetadata, replace: boolean): Promise<void> {
    const file = metaPath(this.key)
    await mkdir(path.dirname(file), { recursive: true })
    const current = replace ? {} : await this.readMeta()
    const merged: FileMetadata = {
      ...current,
      ...(update.contentType ? { contentType: update.contentType } : {}),
      ...(update.metadata || current.metadata
        ? { metadata: { ...current.metadata, ...update.metadata } }
        : {}),
    }
    await writeWhole(file, JSON.stringify(merged))
  }
}

export interface ListResult {
  /** Stored files whose key starts with the prefix, sorted by key. */
  files: StoredFile[]
  /** With `shallow`, the sub-folders at the prefix's level, as `<key>/`. */
  folders: string[]
}

export const fileStore = {
  file(keyOrUri: string): StoredFile {
    return new StoredFile(keyOrUri)
  },

  /**
   * Stored files whose key starts with `prefix` (a plain string prefix, so
   * `tmp/u1/123-` matches `tmp/u1/123-a.png`). `shallow` lists one level only, plus
   * the folders below it. Hidden entries are never listed.
   */
  async list(
    prefix: string,
    options: { limit?: number; shallow?: boolean } = {},
  ): Promise<ListResult> {
    const root = filesRoot()
    const files: StoredFile[] = []
    const folders = new Set<string>()
    const walk = (dir: string) => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        const key = path.relative(root, full).split(path.sep).join('/')
        if (entry.isDirectory()) {
          if (!`${key}/`.startsWith(prefix) && !prefix.startsWith(`${key}/`)) continue
          if (options.shallow && `${key}/`.startsWith(prefix) && key.length >= prefix.length) {
            folders.add(`${key}/`)
          } else walk(full)
        } else if (entry.isFile() && key.startsWith(prefix)) files.push(new StoredFile(key))
      }
    }
    const prefixDir = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : ''
    if (prefixDir) checkStoreKey(prefixDir)
    walk(path.join(root, prefixDir))
    files.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    return {
      files: options.limit ? files.slice(0, options.limit) : files,
      folders: [...folders].sort(),
    }
  },

  /** Deletes every stored file whose key starts with `prefix`. */
  async deletePrefix(prefix: string): Promise<void> {
    const { files } = await fileStore.list(prefix)
    await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })))
  },

  /** Stores a local file at `keyOrUri`. */
  async upload(
    localPath: string,
    keyOrUri: string,
    options: WriteOptions = {},
  ): Promise<StoredFile> {
    const target = new StoredFile(keyOrUri)
    await target.write(await readFile(localPath), options)
    return target
  },
}
