import { isInternalImport } from './is-internal-import'
import type { MetaJson, NpmDep, PackageJson } from './minimize-deps-types'

/**
 * Get package name from an import path.
 * e.g. "@nestjs/common/decorators" -> "@nestjs/common"
 * e.g. "lodash/get" -> "lodash"
 */
export function extractExternalDependencies({
  metaJson,
  packageJson,
  runtimeDeps,
  workspaceRoot,
}: {
  metaJson: MetaJson
  packageJson: PackageJson
  runtimeDeps?: string[]
  workspaceRoot: string
}): PackageJson {
  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies }
  const externalDeps = new Set<string>()

  Object.entries(metaJson.inputs).forEach(([_key, fileInfo]) => {
    fileInfo.imports?.forEach((importInfo) => {
      if (!importInfo.external) return
      if (importInfo.path.startsWith('.')) return
      if (importInfo.path === '<runtime>') return
      const libPath = importInfo.path.split('/')?.[0] || ''
      if (isInternalImport(libPath, workspaceRoot)) return
      externalDeps.add(importInfo.path)
    })
  })

  const minDeps: NpmDep = {}
  const missingDeps: string[] = []

  runtimeDeps?.forEach((dep) => {
    const atIndex = dep.lastIndexOf('@')
    if (atIndex > 0) {
      const depName = dep.slice(0, atIndex)
      const version = dep.slice(atIndex + 1)
      minDeps[depName] = version
    } else if (allDeps[dep]) {
      minDeps[dep] = allDeps[dep]
    }
  })

  externalDeps.forEach((dep) => {
    const packageName = getPackageName(dep)
    if (allDeps[packageName]) {
      minDeps[packageName] = allDeps[packageName]
    } else {
      minDeps[packageName] = '*'
      missingDeps.push(packageName)
    }
  })

  const { name, version } = packageJson
  return { name, version, dependencies: objectSortKeys(minDeps), devDependencies: {}, missingDeps }
}

function getPackageName(importPath: string): string {
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/')
    return parts.slice(0, 2).join('/')
  }
  return importPath.split('/')[0]
}

function objectSortKeys(raw: NpmDep): NpmDep {
  const result: NpmDep = {}
  Object.keys(raw)
    .sort()
    .forEach((key) => {
      result[key] = raw[key]
    })
  return result
}
