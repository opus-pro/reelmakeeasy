import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import * as path from 'node:path'

import type { TsConfigJson } from './minimize-deps-types'

function isBuiltinModule(name: string): boolean {
  const cleanedName = name.startsWith('node:') ? name.slice(5) : name
  return builtinModules.includes(cleanedName)
}

/** Register "@scope/pkg" or "@scope/pkg/*" prefix from tsconfig paths */
function buildPathPrefixIndex(tsConfig: TsConfigJson): Record<string, { key: string }> {
  const index: Record<string, { key: string }> = {}
  if (!tsConfig.compilerOptions?.paths) {
    return index
  }
  for (const [key] of Object.entries(tsConfig.compilerOptions.paths)) {
    const prefix = getPrefix(key)
    index[prefix] = { key }
  }
  return index
}

function getPrefix(raw: string): string {
  if (!raw.includes('/')) {
    return raw
  }
  return raw.slice(0, raw.indexOf('/'))
}

function readTsconfigBaseJson(workspaceRoot: string): TsConfigJson {
  const tsconfigPath = path.join(workspaceRoot, 'tsconfig.base.json')
  const content = readFileSync(tsconfigPath, 'utf8').replace(
    /\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm,
    '$1',
  )
  return JSON.parse(content) as TsConfigJson
}

let pathPrefixCache: null | Record<string, { key: string }> = null
let cacheWorkspaceRoot: null | string = null

function matchTsConfigPath(importPath: string, workspaceRoot: string): boolean {
  if (pathPrefixCache === null || cacheWorkspaceRoot !== workspaceRoot) {
    const tsConfig = readTsconfigBaseJson(workspaceRoot)
    pathPrefixCache = buildPathPrefixIndex(tsConfig)
    cacheWorkspaceRoot = workspaceRoot
  }
  return !!pathPrefixCache[getPrefix(importPath)]
}

/** True if the import is a Node builtin, node:*, in-repo path alias, or relative. */
export function isInternalImport(importPath: string, workspaceRoot: string): boolean {
  if (isBuiltinModule(importPath)) {
    return true
  }
  if (importPath.startsWith('node:')) {
    return true
  }
  if (importPath.startsWith('@prisma-generated')) {
    return true
  }
  if (matchTsConfigPath(importPath, workspaceRoot)) {
    return true
  }
  if (importPath.startsWith('./')) {
    return true
  }
  if (importPath.startsWith('../')) {
    return true
  }

  if (importPath.startsWith('@prisma/client')) {
    return false
  }
  return false
}
