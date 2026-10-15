import * as os from 'node:os'
import * as path from 'node:path'

import { resolveConcatTmpDir } from './concat-tmp-dir'

describe('resolveConcatTmpDir', () => {
  it('uses the OS temp dir when APP_TMP_DIR is unset or empty', () => {
    expect(resolveConcatTmpDir({})).toBe(path.join(os.tmpdir(), 'concat'))
    expect(resolveConcatTmpDir({ APP_TMP_DIR: '' })).toBe(path.join(os.tmpdir(), 'concat'))
  })

  it('uses APP_TMP_DIR when it is set', () => {
    expect(resolveConcatTmpDir({ APP_TMP_DIR: '/data/scratch' })).toBe(
      path.join('/data/scratch', 'concat'),
    )
  })
})
