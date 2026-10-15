import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { fillState } from './fill-state'
import { readInpaintState, writeInpaintStateIfAbsent } from './state-store'

/** A fresh state, told apart from another by its nonce. */
const stateWith = (nonce: string) => fillState({ core: { defaultNonce: nonce } })

const env = { ...process.env }
let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inpaint-state-'))
  process.env['DATA_DIR'] = dataDir
})

afterEach(() => {
  process.env = { ...env }
  fs.rmSync(dataDir, { force: true, recursive: true })
})

describe('writeInpaintStateIfAbsent', () => {
  it('stores the state when there is none, and returns it', async () => {
    const state = stateWith('only')
    expect(await writeInpaintStateIfAbsent('p1', state)).toEqual(state)
    expect(await readInpaintState('p1')).toEqual(state)
  })

  it('keeps the state stored first, and returns that one to a later writer', async () => {
    const first = stateWith('first')
    const second = stateWith('second')
    await writeInpaintStateIfAbsent('p1', first)
    expect(await writeInpaintStateIfAbsent('p1', second)).toEqual(first)
    expect(await readInpaintState('p1')).toEqual(first)
  })

  it('gives two racing writers the same state: the one that won', async () => {
    const a = stateWith('a')
    const b = stateWith('b')
    const [fromA, fromB] = await Promise.all([
      writeInpaintStateIfAbsent('p1', a),
      writeInpaintStateIfAbsent('p1', b),
    ])
    expect(fromA).toEqual(fromB)
    expect(await readInpaintState('p1')).toEqual(fromA)
  })
})
