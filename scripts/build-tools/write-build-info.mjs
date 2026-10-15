import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { getGitSha } = require('./get-git-sha.js')

const AppBuildInfoTargetPath = {
  web: 'apps/web/public',
}
const availableAppNames = Object.keys(AppBuildInfoTargetPath)

const appName = process.argv[2]
if (!availableAppNames.includes(appName)) {
  console.error(
    `Usage: node scripts/build-tools/write-build-info.mjs <${availableAppNames.join('|')}>`,
  )
  process.exit(1)
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const outputDir = path.join(repoRoot, AppBuildInfoTargetPath[appName])
await mkdir(outputDir, { recursive: true })

const payload = {
  gitSha: getGitSha(),
  buildTime: new Date().toISOString(),
}

const outputFile = path.join(outputDir, 'build-info.json')
await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

console.log(`[build-info] ${appName} -> ${outputFile} (${payload.gitSha})`)
