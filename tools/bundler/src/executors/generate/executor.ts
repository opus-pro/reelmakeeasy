import * as path from 'node:path'

import type { ExecutorContext } from '@nx/devkit'

import { generateMinimalPackageJson } from '../../util/generate-package-json'

import type { GenerateExecutorOptions } from './schema'

export default async function generateExecutor(
  opt: GenerateExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  console.info('Executing "bundler:generate"...')

  const workspaceRoot = context.root
  const metaFilePath = path.resolve(workspaceRoot, opt.metaFilePath)
  const packageJsonPath = path.resolve(workspaceRoot, opt.targetFilePath)

  try {
    await generateMinimalPackageJson({
      metaFilePath,
      packageJsonPath,
      runtimeDeps: opt.runtimeDeps,
      workspaceRoot,
    })
    return { success: true }
  } catch (err) {
    console.error(err)
    return { success: false }
  }
}
