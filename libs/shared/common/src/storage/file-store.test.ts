import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { HOSTILE_KEYS, HOSTILE_STORE_URIS } from './address.cases'
import { isMissingObjectError } from './missing'

type FileStoreModule = typeof import('./file-store')

// The signing key is cached per module, so each case loads a fresh copy.
function loadFresh(): FileStoreModule {
  let mod: FileStoreModule | undefined
  jest.isolateModules(() => {
    mod = jest.requireActual<FileStoreModule>('./file-store')
  })
  return mod as FileStoreModule
}

const env = { ...process.env }
let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelmakeeasy-files-'))
  process.env['DATA_DIR'] = dataDir
  delete process.env['FILE_SIGNING_SECRET']
  delete process.env['PUBLIC_FILES_URL']
  delete process.env['PORT']
})

afterEach(() => {
  jest.restoreAllMocks()
  process.env = { ...env }
  fs.rmSync(dataDir, { force: true, recursive: true })
})

function signedWrite(mod: FileStoreModule, key: string, expiresInMs: number) {
  const { signedUrl } = mod.fileStore.file(key).signedUploadUrl(expiresInMs)
  const query = new URL(signedUrl).searchParams
  return { expires: Number(query.get('expires')), key, sig: query.get('sig') ?? '', url: signedUrl }
}

describe('the data folder', () => {
  it('is DATA_DIR', () => {
    expect(loadFresh().dataDir()).toBe(path.resolve(dataDir))
  })
})

describe('signed upload URLs', () => {
  it('signs with FILE_SIGNING_SECRET and verifies the result', () => {
    process.env['FILE_SIGNING_SECRET'] = 'test-secret'
    const mod = loadFresh()
    const signed = signedWrite(mod, 'projects/p1/a b.png', 60_000)

    expect(signed.url.startsWith('http://localhost:5017/api/files/projects/p1/a%20b.png?')).toBe(
      true,
    )
    expect(mod.verifyUploadSignature(signed)).toBe(true)
    // Nothing is written to the data dir when the secret comes from the environment.
    expect(fs.existsSync(path.join(dataDir, 'file-signing.key'))).toBe(false)
  })

  it('rejects a different key, action, expiry or secret', () => {
    process.env['FILE_SIGNING_SECRET'] = 'test-secret'
    const mod = loadFresh()
    const signed = signedWrite(mod, 'projects/p1/a.png', 60_000)

    expect(mod.verifyUploadSignature({ ...signed, key: 'projects/p2/a.png' })).toBe(false)
    expect(mod.verifyUploadSignature({ ...signed, action: 'read' })).toBe(false)
    expect(mod.verifyUploadSignature({ ...signed, expires: signed.expires + 1 })).toBe(false)

    process.env['FILE_SIGNING_SECRET'] = 'another-secret'
    expect(loadFresh().verifyUploadSignature(signed)).toBe(false)
  })

  it('rejects an expired URL', () => {
    process.env['FILE_SIGNING_SECRET'] = 'test-secret'
    const mod = loadFresh()
    expect(mod.verifyUploadSignature(signedWrite(mod, 'projects/p1/a.png', -1))).toBe(false)
  })

  it('without the secret, generates a private key in the data dir and reuses it', () => {
    const first = loadFresh()
    const signed = signedWrite(first, 'projects/p1/a.png', 60_000)
    const keyFile = path.join(dataDir, 'file-signing.key')

    // Windows has no POSIX modes: stat reports 0o666 for any file that isn't read-only.
    if (process.platform !== 'win32') expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600)
    expect(first.verifyUploadSignature(signed)).toBe(true)
    // A restart reads the same key back, so URLs minted before it still verify.
    expect(loadFresh().verifyUploadSignature(signed)).toBe(true)
  })
})

describe('filePath', () => {
  it('resolves an address or a key inside the stored files', () => {
    const mod = loadFresh()
    const expected = path.join(dataDir, 'files', 'projects', 'p1', 'a b.png')
    expect(mod.filePath('store://projects/p1/a b.png')).toBe(expected)
    expect(mod.filePath('store://projects/p1/a%20b.png')).toBe(expected)
    expect(mod.filePath('projects/p1/a b.png')).toBe(expected)
  })

  it.each([...HOSTILE_KEYS, ...HOSTILE_STORE_URIS.filter((uri) => uri.startsWith('store://'))])(
    'refuses %j',
    (value) => {
      const mod = loadFresh()
      expect(() => mod.filePath(value)).toThrow()
      expect(() => mod.fileStore.file(value)).toThrow()
    },
  )

  it('never reaches the signing key, the run records or the sidecars', () => {
    const mod = loadFresh()
    for (const value of [
      'store://../file-signing.key',
      'store://%2E%2E/kv.json',
      'store://..%2Fworkflow-runs.json',
      'store://..%252Fkv.json',
      '../files-meta/projects/p1/a.png.json',
    ]) {
      expect(() => mod.filePath(value)).toThrow()
    }
  })
})

describe('links inside the stored files', () => {
  // A project folder is linked into the agent's working folder, so the agent can put a link
  // there: following it must never reach the data dir's own records or anything else on disk.
  const SECRET = 'the signing key'

  function link(target: string, key: string): void {
    const at = path.join(dataDir, 'files', key)
    fs.mkdirSync(path.dirname(at), { recursive: true })
    fs.symlinkSync(target, at)
  }

  beforeEach(() => {
    fs.writeFileSync(path.join(dataDir, 'file-signing.key'), SECRET)
    fs.writeFileSync(path.join(dataDir, 'kv.json'), SECRET)
  })

  it('refuses a file linked to one outside the stored files', async () => {
    const { fileStore, filePath } = loadFresh()
    link(path.join(dataDir, 'file-signing.key'), 'projects/p1/leak.png')
    link('../../../kv.json', 'projects/p1/relative.png')
    for (const key of ['projects/p1/leak.png', 'projects/p1/relative.png']) {
      expect(() => filePath(key)).toThrow()
      expect(await fileStore.file(key).exists()).toBe(false)
      await expect(fileStore.file(key).read()).rejects.toThrow()
      expect(() => fileStore.file(key).createReadStream()).toThrow()
    }
  })

  it('refuses a path through a folder linked outside, for reads and writes', async () => {
    const { fileStore, filePath } = loadFresh()
    link(dataDir, 'projects/p2')
    expect(() => filePath('projects/p2/kv.json')).toThrow()
    await expect(fileStore.file('projects/p2/kv.json').read()).rejects.toThrow()
    await expect(fileStore.file('projects/p2/new.txt').write('x')).rejects.toThrow()
    expect(() => fileStore.file('projects/p2/new.txt').createWriteStream()).toThrow()
    expect(fs.existsSync(path.join(dataDir, 'new.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(dataDir, 'kv.json'), 'utf8')).toBe(SECRET)
  })

  it('refuses a link to nothing, which a write would follow out', async () => {
    const { fileStore, filePath } = loadFresh()
    const outside = path.join(dataDir, 'created-outside.txt')
    link(outside, 'projects/p1/dangling.txt')
    expect(() => filePath('projects/p1/dangling.txt')).toThrow()
    expect(() => fileStore.file('projects/p1/dangling.txt').createWriteStream()).toThrow()
    expect(fs.existsSync(outside)).toBe(false)
  })

  it('follows a link that stays inside, and a files folder that is itself a link', async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'reelmakeeasy-files-disk-'))
    try {
      fs.symlinkSync(elsewhere, path.join(dataDir, 'files'))
      const { fileStore } = loadFresh()
      await fileStore.file('projects/p1/a.png').write('png')
      link('p1', 'projects/p3')
      expect((await fileStore.file('projects/p3/a.png').read()).toString()).toBe('png')
      expect(fs.readFileSync(path.join(elsewhere, 'projects', 'p1', 'a.png'), 'utf8')).toBe('png')
    } finally {
      fs.rmSync(elsewhere, { force: true, recursive: true })
    }
  })
})

describe('StoredFile', () => {
  it('finishes a write stream only once its metadata is on disk, and fails it when that write fails', async () => {
    const { fileStore } = loadFresh()
    const file = fileStore.file('tmp/u1/upload.bin')
    await pipeline(
      Readable.from([Buffer.from('up')]),
      file.createWriteStream({ contentType: 'image/png' }),
    )
    expect(fs.existsSync(path.join(dataDir, 'files-meta', 'tmp', 'u1', 'upload.bin.json'))).toBe(
      true,
    )
    expect((await file.stat()).contentType).toBe('image/png')

    // A folder where the sidecar should go: its write fails, and so does the stream.
    fs.mkdirSync(path.join(dataDir, 'files-meta', 'tmp', 'u1', 'broken.bin.json'), {
      recursive: true,
    })
    await expect(
      pipeline(
        Readable.from([Buffer.from('x')]),
        fileStore.file('tmp/u1/broken.bin').createWriteStream(),
      ),
    ).rejects.toThrow()
  })

  it('writes, reads, describes and deletes a file, with its metadata outside the served folder', async () => {
    const { fileStore } = loadFresh()
    const file = fileStore.file('store://projects/p1/long_take/kf-01.png')
    expect(await file.exists()).toBe(false)

    await file.write(Buffer.from('png'), { metadata: { source: 'a' } })

    expect(await file.exists()).toBe(true)
    expect((await file.read()).toString()).toBe('png')
    expect((await file.read({ start: 1, end: 1 })).toString()).toBe('n')
    const info = await file.stat()
    expect(info).toMatchObject({ contentType: 'image/png', custom: { source: 'a' }, size: 3 })
    expect(file.uri).toBe('store://projects/p1/long_take/kf-01.png')
    expect(file.url()).toBe('http://localhost:5017/api/files/projects/p1/long_take/kf-01.png')
    expect(fs.readdirSync(path.join(dataDir, 'files', 'projects', 'p1', 'long_take'))).toEqual([
      'kf-01.png',
    ])
    expect(
      fs.existsSync(
        path.join(dataDir, 'files-meta', 'projects', 'p1', 'long_take', 'kf-01.png.json'),
      ),
    ).toBe(true)

    await file.delete()
    expect(await file.exists()).toBe(false)
    await expect(file.delete()).rejects.toMatchObject({ code: 404 })
    await file.delete({ ignoreNotFound: true })
  })

  it('replaces a file whole: a write that stops part way leaves the old content', async () => {
    const { fileStore } = loadFresh()
    const file = fileStore.file('projects/p1/long_take/beat_loop_qa.json')
    await file.write('{"clips":[1]}')
    const write = fsp.writeFile
    jest.spyOn(fsp, 'writeFile').mockImplementationOnce(async (target) => {
      // A crash or a full disk part way through the write.
      await write(target, '{"cli')
      throw new Error('disk full')
    })

    await expect(file.write('{"clips":[1,2]}')).rejects.toThrow('disk full')

    expect((await file.read()).toString()).toBe('{"clips":[1]}')
    // Nothing half written is left next to it, or listed with the project's files.
    const { files } = await fileStore.list('projects/p1/')
    expect(files.map((f) => f.key)).toEqual(['projects/p1/long_take/beat_loop_qa.json'])
    expect(fs.readdirSync(path.join(dataDir, 'files', 'projects', 'p1', 'long_take'))).toEqual([
      'beat_loop_qa.json',
    ])

    await file.write('{"clips":[1,2]}')
    expect((await file.read()).toString()).toBe('{"clips":[1,2]}')
  })

  it('writes over only the version it read', async () => {
    const { fileStore, isVersionConflictError } = loadFresh()
    const file = fileStore.file('projects/p1/final_video.mp4')
    await file.write('v1', { ifVersionMatch: 0 })
    const read = (await file.stat()).version

    await new Promise((resolve) => setTimeout(resolve, 5))
    await file.write('v2', { ifVersionMatch: read })
    const conflict = await file
      .write('v3', { ifVersionMatch: read })
      .catch((error: unknown) => error)

    expect(isVersionConflictError(conflict)).toBe(true)
    expect((await file.read()).toString()).toBe('v2')
    expect(await file.writeIfAbsent('v4')).toBe(false)
    expect(await fileStore.file('projects/p1/other.mp4').writeIfAbsent('v1')).toBe(true)
  })

  it('lets one of two racing create-only writes win', async () => {
    const { fileStore } = loadFresh()
    const results = await Promise.all(
      ['a', 'b', 'c'].map((body) =>
        fileStore.file('editor/p1/inpaint/workflow-state.json').writeIfAbsent(body),
      ),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('copies a file with its metadata', async () => {
    const { fileStore } = loadFresh()
    await fileStore.file('projects/p1/a.png').write('png', { metadata: { k: 'v' } })
    const copy = await fileStore.file('projects/p1/a.png').copyTo('store://projects/p2/a.png')
    expect((await copy.read()).toString()).toBe('png')
    expect((await copy.stat()).custom).toEqual({ k: 'v' })
  })
})

describe('fileStore.list', () => {
  it('lists by string prefix, skips hidden entries, and can list one level', async () => {
    const { fileStore } = loadFresh()
    for (const key of [
      'tmp/u1/1-a.png',
      'tmp/u1/1-b.png',
      'tmp/u1/2-c.png',
      'tmp/u1/sub/d.png',
      'tmp/u2/e.png',
    ]) {
      await fileStore.file(key).write('x')
    }
    fs.writeFileSync(path.join(dataDir, 'files', 'tmp', 'u1', '.DS_Store'), '')

    expect((await fileStore.list('tmp/u1/1-')).files.map((f) => f.key)).toEqual([
      'tmp/u1/1-a.png',
      'tmp/u1/1-b.png',
    ])
    expect((await fileStore.list('tmp/u1/')).files.map((f) => f.key)).toEqual([
      'tmp/u1/1-a.png',
      'tmp/u1/1-b.png',
      'tmp/u1/2-c.png',
      'tmp/u1/sub/d.png',
    ])
    const shallow = await fileStore.list('tmp/u1/', { shallow: true })
    expect(shallow.files.map((f) => f.key)).toEqual([
      'tmp/u1/1-a.png',
      'tmp/u1/1-b.png',
      'tmp/u1/2-c.png',
    ])
    expect(shallow.folders).toEqual(['tmp/u1/sub/'])
    expect((await fileStore.list('tmp/u1/', { limit: 1 })).files).toHaveLength(1)
    expect((await fileStore.list('nothing/here/')).files).toEqual([])

    await fileStore.deletePrefix('tmp/u1/')
    expect((await fileStore.list('tmp/')).files.map((f) => f.key)).toEqual(['tmp/u2/e.png'])
  })
})

describe('isMissingObjectError', () => {
  it('is true only for a file that is not there, never for one that is unreadable', async () => {
    const { fileStore } = loadFresh()
    const missing = await fileStore
      .file('projects/p1/none.json')
      .read()
      .catch((error: unknown) => error)
    expect(isMissingObjectError(missing)).toBe(true)
    expect(
      isMissingObjectError(
        await fileStore
          .file('projects/p1/none.json')
          .stat()
          .catch((e: unknown) => e),
      ),
    ).toBe(true)
    expect(isMissingObjectError(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toBe(true)
    expect(isMissingObjectError(new SyntaxError('Unexpected end of JSON input'))).toBe(false)
    expect(isMissingObjectError(Object.assign(new Error('I/O error'), { code: 'EIO' }))).toBe(false)
    expect(isMissingObjectError(undefined)).toBe(false)
  })
})
