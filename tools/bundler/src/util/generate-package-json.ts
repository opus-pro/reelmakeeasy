import * as fs from 'node:fs'
import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'

import { extractExternalDependencies } from '../executors/bundle/util/extract-dependencies'
import type { MetaJson, PackageJson } from '../executors/bundle/util/minimize-deps-types'

export async function generateMinimalPackageJson({
  metaFilePath,
  packageJsonPath,
  runtimeDeps,
  workspaceRoot,
}: {
  metaFilePath: string
  packageJsonPath: string
  runtimeDeps?: string[]
  workspaceRoot: string
}): Promise<void> {
  const metaJson: MetaJson = JSON.parse(fs.readFileSync(metaFilePath, 'utf8'))
  const packageJson = getBaseProjectJson(workspaceRoot)

  const minimalPackageJson = extractExternalDependencies({
    metaJson,
    packageJson,
    runtimeDeps,
    workspaceRoot,
  })

  await writeFile(packageJsonPath, JSON.stringify(minimalPackageJson, null, 2))
  console.log(`  Wrote package.json: ${packageJsonPath}`)

  if (minimalPackageJson.missingDeps.length > 0) {
    console.error(`  Missing deps: ${minimalPackageJson.missingDeps.join(', ')}`)
    throw new Error('Missing dependencies in minimal package.json')
  }
}

function getBaseProjectJson(workspaceRoot: string): PackageJson {
  const pkgPath = path.join(workspaceRoot, 'package.json')
  const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
  return {
    dependencies: (raw.dependencies as PackageJson['dependencies']) ?? {},
    devDependencies: (raw.devDependencies as PackageJson['devDependencies']) ?? {},
    missingDeps: [],
    name: (raw.name as string) ?? '',
    version: (raw.version as string) ?? '0.0.0',
  }
}
