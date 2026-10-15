import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { presetPackVersion } from '@reelmakeeasy/common/storage/presets'
import express from 'express'
import nock from 'nock'

import { CaptionFontsController } from './caption-fonts.controller'
import { CaptionFontsService } from './caption-fonts.service'

const ANTON = Buffer.from('Anton-Regular stand-in bytes')

/** A plain HTTP request to this test's own server (fetch is stubbed out in tests). */
function request(
  url: string,
  method = 'GET',
): Promise<{ body: Buffer; headers: http.IncomingHttpHeaders; status: number }> {
  return new Promise((resolve, reject) => {
    http
      .request(url, { method }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            body: Buffer.concat(chunks),
            headers: res.headers,
            status: res.statusCode ?? 0,
          }),
        )
      })
      .on('error', reject)
      .end()
  })
}

describe('CaptionFontsController', () => {
  const env = { ...process.env }
  let dataDir: string
  let base: string
  let server: ReturnType<ReturnType<typeof express>['listen']>
  let controller: CaptionFontsController

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-fonts-api-'))
    process.env['DATA_DIR'] = dataDir
    process.env['PUBLIC_FILES_URL'] = 'http://localhost:5017/api/files'
    // A stand-in render font pack: one pack face, and a file that is not one.
    const staging = path.join(dataDir, 'staging')
    fs.mkdirSync(path.join(staging, 'fonts'), { recursive: true })
    fs.writeFileSync(path.join(staging, 'fonts', 'Anton-Regular.ttf'), ANTON)
    fs.writeFileSync(path.join(staging, 'fonts', 'notes.txt'), 'not a font')
    const render = path.join(dataDir, 'presets', presetPackVersion(), 'render')
    fs.mkdirSync(render, { recursive: true })
    execFileSync('tar', ['-czf', path.join(render, 'fonts.tar.gz'), '-C', staging, 'fonts'])

    controller = new CaptionFontsController(new CaptionFontsService())
    const app = express()
    app.get('/api/caption-fonts', (_req, res) => {
      res.json(controller.list())
    })
    app.get('/api/caption-fonts/pack/:file', (req, res) => {
      void controller.servePack(req.params.file, res)
    })
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/caption-fonts`
    // Only this test's own server, on this computer.
    nock.enableNetConnect('127.0.0.1')
  })

  afterAll(async () => {
    nock.disableNetConnect()
    await new Promise((resolve) => server.close(resolve))
    process.env = env
    fs.rmSync(dataDir, { force: true, recursive: true })
  })

  it('lists the render pack fonts in the picker order, each with its weights and a sample', async () => {
    const body = JSON.parse((await request(base)).body.toString())
    const version = presetPackVersion()
    expect(body.data.pack.map((f: { family: string }) => f.family)).toEqual([
      'Anton',
      'DM Sans',
      'Dela Gothic One',
      'Roboto',
      'Alegreya',
      'PT Serif',
      'Roboto Serif',
    ])
    expect(body.data.pack[0]).toEqual({
      family: 'Anton',
      sampleUrl: `http://localhost:5017/api/caption-fonts/pack/Anton-Regular.ttf?v=${version}`,
      weights: [400],
    })
    expect(body.data.pack[3]).toEqual({
      family: 'Roboto',
      sampleUrl: `http://localhost:5017/api/caption-fonts/pack/Roboto-Black.ttf?v=${version}`,
      weights: [300, 400, 500, 600, 700, 900],
    })
  })

  it('serves a pack face, unpacked on demand into the render font cache, cached for good', async () => {
    const res = await request(`${base}/pack/Anton-Regular.ttf?v=${presetPackVersion()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(ANTON)
    expect(res.headers['content-type']).toBe('font/ttf')
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-encoding']).toBeUndefined()
    const cached = path.join(
      dataDir,
      'cache',
      'render-fonts',
      presetPackVersion(),
      'Anton-Regular.ttf',
    )
    expect(fs.readFileSync(cached)).toEqual(ANTON)
    // Served from the cache from then on.
    const head = await request(`${base}/pack/Anton-Regular.ttf`, 'HEAD')
    expect(head.status).toBe(200)
    expect(head.headers['content-length']).toBe(String(ANTON.length))
  })

  it.each([
    'notes.txt',
    'Inter.ttf',
    'Montserrat-Black.ttf',
    'anton-regular.ttf',
    '..%2F..%2Fpack.json',
    '..%2Fpresets%2Fv007%2Frender%2Ffonts.tar.gz',
    '%2Fetc%2Fpasswd',
  ])('answers 404 for %s, which is not a pack family face', async (file) => {
    const res = await request(`${base}/pack/${file}`)
    expect(res.status).toBe(404)
  })

  it('answers 404 for a pack face missing from the installed pack', async () => {
    const res = await request(`${base}/pack/Roboto-Black.ttf`)
    expect(res.status).toBe(404)
  })

  it('answers 404 when no render pack is installed', async () => {
    fs.rmSync(path.join(dataDir, 'presets'), { force: true, recursive: true })
    const res = await request(`${base}/pack/DMSans-Bold.ttf`)
    expect(res.status).toBe(404)
  })
})
