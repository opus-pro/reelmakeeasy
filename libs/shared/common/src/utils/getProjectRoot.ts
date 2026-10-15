import * as fs from 'node:fs'
import * as path from 'node:path'

import { getNodeLocalScratchRoot } from './path.util'

export function getProjectPath(...paths: string[]) {
  const projectRoot = getProjectRoot()
  const result = path.resolve(projectRoot, ...paths)
  fs.mkdirSync(path.dirname(result), { recursive: true })
  return result
}
export function getProjectRoot(startPath = process.cwd()) {
  let currentPath = startPath

  while (true) {
    const nodeModulesPath = path.join(currentPath, 'node_modules')
    if (fs.existsSync(nodeModulesPath) && fs.statSync(nodeModulesPath).isDirectory()) {
      return currentPath
    }

    const parentPath = path.dirname(currentPath)

    if (parentPath === currentPath) {
      throw new Error('can not find project root')
    }

    currentPath = parentPath
  }
}
export function getProjectTmpPath(projectId: string, ...paths: string[]) {
  // Per-pod scratch resolves under the node-local scratch root.
  // getNodeLocalScratchRoot() is absolute, so path.resolve inside getProjectPath
  // rebases onto it while preserving the mkdir side effect.
  return getProjectPath(getNodeLocalScratchRoot(), projectId, ...paths)
}
