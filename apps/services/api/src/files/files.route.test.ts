import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { HOSTILE_KEYS } from '@reelmakeeasy/common/storage/address.cases'
import { HttpException } from '@nestjs/common'
import express from 'express'
import nock from 'nock'

type FileStoreModule = typeof import('@reelmakeeasy/common/storage/file-store')
type ControllerModule = typeof import('./files.controller')

/** A plain HTTP request to this test's own server (fetch is stubbed out in tests). */
function request(
  url: string,
  options: { body?: string; method?: string } = {},
): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method ?? 'GET' }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () =>
        resolve({ body: Buffer.concat(chunks).toString(), status: res.statusCode ?? 0 }),
      )
    })
    req.on('error', reject)
    req.end(options.body)
  })
}

const SECRET = 'the signing key'

describe('the files route', () => {
  const env = { ...process.env }
  let dataDir: string
  let base: string
  let files: FileStoreModule
  let server: http.Server

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-route-'))
    process.env['DATA_DIR'] = dataDir
    process.env['FILE_SIGNING_SECRET'] = 'test-secret'
    // What must never be served: the data dir's own records, next to the files folder.
    fs.writeFileSync(path.join(dataDir, 'file-signing.key'), SECRET)
    fs.writeFileSync(path.join(dataDir, 'kv.json'), SECRET)
    let controllerModule: ControllerModule | undefined
    jest.isolateModules(() => {
      files = jest.requireActual<FileStoreModule>('@reelmakeeasy/common/storage/file-store')
      controllerModule = jest.requireActual<ControllerModule>('./files.controller')
    })
    const controller = new controllerModule!.FilesController()
    await files.fileStore.file('projects/p1/a b.png').write('png bytes')

    const app = express()
    app.use('/api/files', (req, res) => {
      // The key as Nest's `*key` route hands it over: the decoded path segments.
      let key: string[]
      try {
        key = req.path.slice(1).split('/').map(decodeURIComponent)
      } catch {
        res.status(400).end()
        return
      }
      // The controller was loaded in isolation, with its own copy of @nestjs/common.
      const fail = (error: unknown) =>
        res.status((error as Partial<HttpException>).getStatus?.() ?? 500).end()
      try {
        if (req.method === 'PUT') {
          const query = req.query as Record<string, string>
          controller.upload(key, query['expires'], query['sig'], req, res).catch(fail)
        } else {
          controller.serve(key, undefined, res)
        }
      } catch (error) {
        fail(error)
      }
    })
    nock.enableNetConnect('127.0.0.1')
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/files`
  })

  afterAll(async () => {
    nock.disableNetConnect()
    await new Promise((resolve) => server.close(resolve))
    process.env = { ...env }
    fs.rmSync(dataDir, { force: true, recursive: true })
  })

  it('serves a stored file at /api/files/<key>, with no bucket', async () => {
    const res = await request(`${base}/projects/p1/a%20b.png`)
    expect(res).toEqual({ body: 'png bytes', status: 200 })
  })

  it.each(HOSTILE_KEYS.filter((key) => key !== ''))('never serves the key %j', async (key) => {
    const encoded = key.split('/').map(encodeURIComponent).join('/')
    for (const url of [`${base}/${encoded}`, `${base}/${encodeURIComponent(key)}`]) {
      const res = await request(url)
      expect([400, 404]).toContain(res.status)
      expect(res.body).not.toContain(SECRET)
    }
  })

  it('refuses double-encoded and hidden paths outright', async () => {
    for (const tail of ['..%2Fkv.json', 'projects/%252E%252E/%252E%252E/kv.json', '.tmp/x']) {
      expect((await request(`${base}/${tail}`)).status).toBe(400)
    }
    // A client resolves `%2E%2E` as `..` before sending, so this never reaches the route.
    const res = await request(`${base}/%2E%2E/file-signing.key`)
    expect([400, 404]).toContain(res.status)
    expect(res.body).not.toContain(SECRET)
  })

  it('never follows a link out of the stored files', async () => {
    // The agent can write into a project folder (it is linked into its working folder).
    const project = path.join(dataDir, 'files', 'projects', 'p1')
    fs.symlinkSync(path.join(dataDir, 'file-signing.key'), path.join(project, 'key.png'))
    fs.symlinkSync('../../../kv.json', path.join(project, 'kv.png'))
    fs.symlinkSync(dataDir, path.join(dataDir, 'files', 'projects', 'p2'))
    for (const tail of ['projects/p1/key.png', 'projects/p1/kv.png', 'projects/p2/kv.json']) {
      const res = await request(`${base}/${tail}`)
      expect(res.status).toBe(404)
      expect(res.body).not.toContain(SECRET)
    }
    // A file a link inside points at is still served.
    fs.symlinkSync('p1', path.join(dataDir, 'files', 'projects', 'p3'))
    expect(await request(`${base}/projects/p3/a%20b.png`)).toEqual({
      body: 'png bytes',
      status: 200,
    })
  })

  it('accepts an upload to a signed URL, and only to the key it was signed for', async () => {
    const { signedUrl } = files.fileStore.file('tmp/u1/upload.png').signedUploadUrl()
    const query = new URL(signedUrl).search
    expect(
      (await request(`${base}/tmp/u1/upload.png${query}`, { body: 'up', method: 'PUT' })).status,
    ).toBe(200)
    expect((await files.fileStore.file('tmp/u1/upload.png').read()).toString()).toBe('up')

    const elsewhere = await request(`${base}/tmp/u2/upload.png${query}`, {
      body: 'x',
      method: 'PUT',
    })
    expect(elsewhere.status).toBe(403)
    const climbing = await request(`${base}/tmp/u1/%2E%2E/u2/upload.png${query}`, {
      body: 'x',
      method: 'PUT',
    })
    // Refused either way: a bad key (400), or a signature for another key (403).
    expect([400, 403]).toContain(climbing.status)
    expect(await files.fileStore.file('tmp/u2/upload.png').exists()).toBe(false)
  })
})
