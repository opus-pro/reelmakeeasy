import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dirname, join } from 'node:path'

import { isEval, isTest } from './env'

export async function ensureDirectoryExists(filePath: string) {
  const ext = path.extname(filePath)
  if (ext) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  } else {
    await fs.promises.mkdir(filePath, { recursive: true })
  }
}
export function ensureDirectoryExistsSync(filePath: string) {
  const ext = path.extname(filePath)
  if (ext) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  } else {
    fs.mkdirSync(filePath, { recursive: true })
  }
}
export async function readJsonFile<T = object>(filePath: string): Promise<T | undefined> {
  if (!(await fs.promises.stat(filePath).catch(() => ({ isFile: () => false })))?.isFile()) {
    return undefined
  }
  const content = await fs.promises.readFile(filePath, 'utf8')
  return JSON.parse(content) as T
}
export function readJsonFileSync<T = object>(filePath: string): T | undefined {
  try {
    if (!fs.statSync(filePath)?.isFile()) {
      return undefined
    }
  } catch (_e) {
    return undefined
  }
  const content = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(content) as T
}
export async function writeJsonFile<T = object>(filePath: string, data: T) {
  await ensureDirectoryExists(filePath)
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2))
}
export function writeJsonFileSync<T = object>(filePath: string, data: T) {
  ensureDirectoryExistsSync(filePath)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

let validCwd = ''
/**
 * Get current working directory, add a fallback for running tests
 * @returns Current working directory
 */
export function getCwd() {
  if (validCwd) {
    return validCwd
  }
  let cwd = process.cwd()
  if (isEval() && cwd.endsWith('eval/worker')) {
    cwd = path.resolve(cwd, '../../../')
  }
  if (!isTest()) {
    return cwd
  }

  while (true) {
    // find the folder that contains pnpm-lock.yaml
    const pnpmLockPath = join(cwd, 'pnpm-lock.yaml')
    if (fs.existsSync(pnpmLockPath)) {
      validCwd = cwd
      return validCwd
    }
    const parentPath = dirname(cwd)
    if (parentPath === cwd) {
      throw new Error('can not find project root')
    }
    cwd = parentPath
    validCwd = parentPath
  }
}

/**
 * Root for per-pod ephemeral scratch, under the node-local tmp dir. Single
 * source of truth for the ephemeral scratch root.
 */
export function getNodeLocalScratchRoot(): string {
  return path.join(os.tmpdir(), 'ao-scratch')
}

/**
 * Root for the node-local storage download/upload cache, under the node-local tmp
 * dir. Single source of truth for the ephemeral cache root.
 */
export function getNodeLocalCacheRoot(): string {
  return path.join(os.tmpdir(), 'ao-cache')
}

/**
 * Get project root directory
 * This is used to locate shared resources like python scripts
 *
 */
export function getProjectRoot(): string {
  const cwd = process.cwd()

  if (isEval() && cwd.endsWith('eval/worker')) {
    return path.resolve(cwd, '../../../')
  }

  return cwd
}
