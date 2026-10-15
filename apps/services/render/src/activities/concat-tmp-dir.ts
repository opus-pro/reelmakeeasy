import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Scratch folder for a concat job's downloads and output. `APP_TMP_DIR`
 * overrides the base folder; otherwise it sits under the OS temp dir.
 */
export function resolveConcatTmpDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env['APP_TMP_DIR'] || os.tmpdir(), 'concat')
}
