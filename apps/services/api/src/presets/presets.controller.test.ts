import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { CAMERA_SAMPLES } from '@reelmakeeasy/common/storage/camera-samples'
import { presetPackVersion } from '@reelmakeeasy/common/storage/presets'
import { BadRequestException } from '@nestjs/common'
import express from 'express'
import nock from 'nock'

import { PresetsController } from './presets.controller'

const CLIP = Buffer.from('dynamic sample stand-in bytes')
const POSTER = Buffer.from('dynamic poster stand-in bytes')

/** A plain HTTP request to this test's own server (fetch is stubbed out in tests). */
function request(
  url: string,
): Promise<{ body: Buffer; headers: http.IncomingHttpHeaders; status: number }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
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
  })
}

describe('PresetsController', () => {
  const env = { ...process.env }
  const controller = new PresetsController()
  let dataDir: string
  let base: string
  let server: ReturnType<ReturnType<typeof express>['listen']>

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-api-'))
    process.env['DATA_DIR'] = dataDir
    // A stand-in installed pack holding the Dynamic sample.
    const pack = path.join(dataDir, 'presets', presetPackVersion())
    fs.mkdirSync(path.join(pack, 'camera-samples'), { recursive: true })
    fs.writeFileSync(path.join(pack, CAMERA_SAMPLES.dynamic.video), CLIP)
    fs.writeFileSync(path.join(pack, CAMERA_SAMPLES.dynamic.poster), POSTER)

    const app = express()
    app.use('/api/presets', (req, res) => {
      // The key as Nest's `*key` route hands it over: the decoded path segments.
      const key = req.path.slice(1).split('/').map(decodeURIComponent)
      try {
        controller.serve(key, res)
      } catch (err) {
        res.status(err instanceof BadRequestException ? 400 : 500).end()
      }
    })
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/presets`
    // Only this test's own server, on this computer.
    nock.enableNetConnect('127.0.0.1')
  })

  afterAll(async () => {
    nock.disableNetConnect()
    await new Promise((resolve) => server.close(resolve))
    process.env = env
    fs.rmSync(dataDir, { force: true, recursive: true })
  })

  it('serves a camera sample clip from the installed pack, cached for good', async () => {
    const res = await request(`${base}/${presetPackVersion()}/${CAMERA_SAMPLES.dynamic.video}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('video/mp4')
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(res.body).toEqual(CLIP)
  })

  it('serves its poster as a JPEG', async () => {
    const res = await request(`${base}/${presetPackVersion()}/${CAMERA_SAMPLES.dynamic.poster}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.body).toEqual(POSTER)
  })

  it('answers 404 for a sample the installed pack does not have', async () => {
    const res = await request(`${base}/${presetPackVersion()}/${CAMERA_SAMPLES.calm.video}`)
    expect(res.status).toBe(404)
  })

  it('refuses a path that leaves the pack', async () => {
    const res = await request(`${base}/${presetPackVersion()}/..%2F..%2Ffile-signing.key`)
    expect(res.status).toBe(400)
  })
})
