import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { ExecutorContext } from '@nx/devkit'
import fg from 'fast-glob'

import { generateMinimalPackageJson } from '../../util/generate-package-json'

import type { BundleAsset, BundleExecutorOptions } from './schema'

const esbuildDefaults = {
  bundle: true,
  platform: 'node' as const,
  packages: 'external' as const,
  format: 'cjs' as const,
  sourcemap: false,
  minify: false,
}

export interface ResolvedBundleOptions {
  esbuildOpts: EsbuildOptions
  generateMinimalDeps: boolean
  mainFileAbsolute: string
  metaFileAbsolute: string
  options: BundleExecutorOptions
  outputDir: string
  outputDirAbsolute: string
  outputFile: string
  outputFileAbsolute: string
  projectRootAbsolute: string
  runTsc: boolean
  tscCommand: string
  tscCwd: string
  tscCwdAbsolute: string
  tsconfigAbsolute: null | string
  tscOutputDir: string
  workspaceRoot: string
}

/** Resolved esbuild options (defaults + overrides); allows all values from schema. */
type EsbuildOptions = Required<NonNullable<BundleExecutorOptions['esbuildOptions']>>

/** Replaces {projectRoot} and {workspaceRoot} in option strings. */
export default async function bundleExecutor(
  options: BundleExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  console.info('Executing "bundler:bundle"...')

  try {
    const projectName = context.projectName
    if (!projectName) {
      throw new Error('Project name is required')
    }

    const projectRoot = context.projectsConfigurations?.projects[projectName]?.root
    if (!projectRoot) {
      throw new Error(`Could not find project root for ${projectName}`)
    }

    const opts = resolveBundleOptions(options, context.root, projectRoot)

    await runTscStep(opts)
    await runEsbuildStep(opts)
    await runMinimizedDepsStep(opts, context)
    copyAssetsStep(opts)

    console.log('✓ Build bundle completed successfully!')
    return { success: true }
  } catch (err) {
    console.error('✗ Build bundle failed:', err)
    return { success: false }
  }
}

function normalizeOptions(
  options: BundleExecutorOptions,
  workspaceRoot: string,
  projectRoot: string,
): BundleExecutorOptions {
  const replace = (s: string) => replaceOptionTokens(s, workspaceRoot, projectRoot)
  const normalizedAssets =
    options.assets?.map((a: BundleAsset) =>
      typeof a === 'string'
        ? replace(a)
        : {
            ...a,
            input: replace(a.input),
            output: replace(a.output),
          },
    ) ?? options.assets
  return {
    ...options,
    mainFile: replace(options.mainFile),
    outputDir: replace(options.outputDir),
    outputFile: replace(options.outputFile),
    tscCommand: replace(options.tscCommand),
    tscOutputDir: replace(options.tscOutputDir),
    ...(options.tscCwd !== undefined && { tscCwd: replace(options.tscCwd) }),
    ...(options.tsConfigPath !== undefined && {
      tsConfigPath: replace(options.tsConfigPath),
    }),
    ...(normalizedAssets !== undefined && { assets: normalizedAssets }),
  }
}

function replaceOptionTokens(value: string, workspaceRoot: string, projectRoot: string): string {
  return value.replace(/\{workspaceRoot\}/g, workspaceRoot).replace(/\{projectRoot\}/g, projectRoot)
}

/**
 * Ensures a resolved path stays at or under root (no absolute second segments, no `..` escape).
 * Uses logical resolution only (no fs.realpath).
 */
function assertResolvedPathUnderRoot(
  rootAbsolute: string,
  targetAbsolute: string,
  context: string,
): void {
  const root = path.resolve(rootAbsolute)
  const target = path.resolve(targetAbsolute)
  if (target === root) {
    return
  }
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `${context}: path must stay under bundle output directory "${root}", resolved to "${target}"`,
    )
  }
}

function resolveBundleOptions(
  options: BundleExecutorOptions,
  workspaceRoot: string,
  projectRoot: string,
): ResolvedBundleOptions {
  const opts = normalizeOptions(options, workspaceRoot, projectRoot)
  const projectRootAbsolute = path.resolve(workspaceRoot, projectRoot)
  const { generateMinimalDeps, runTsc, tscOutputDir, outputDir, outputFile } = opts
  const tscCwd = opts.tscCwd ?? projectRoot
  return {
    esbuildOpts: { ...esbuildDefaults, ...opts.esbuildOptions },
    generateMinimalDeps,
    mainFileAbsolute: resolveMainFileAbsolute({
      mainFile: opts.mainFile,
      projectRoot,
      projectRootAbsolute,
      runTsc,
      tscOutputDir,
    }),
    metaFileAbsolute: path.resolve(projectRootAbsolute, outputDir, 'meta.json'),
    options: opts,
    outputDir,
    outputDirAbsolute: path.resolve(projectRootAbsolute, outputDir),
    outputFile,
    outputFileAbsolute: path.resolve(projectRootAbsolute, outputDir, outputFile),
    projectRootAbsolute,
    runTsc,
    tscCommand: opts.tscCommand,
    tscCwd,
    tscCwdAbsolute: path.resolve(workspaceRoot, tscCwd),
    tsconfigAbsolute: opts.tsConfigPath
      ? path.resolve(projectRootAbsolute, opts.tsConfigPath)
      : null,
    tscOutputDir,
    workspaceRoot,
  }
}

/**
 * Resolves the absolute path for the ESBuild entry file.
 * mainFile is always the TypeScript entry (e.g. src/main.ts).
 * - If runTsc: true and mainFile is .ts/.tsx, returns the compiled .js at
 *   tscOutputDir/{projectRoot}/... (full project tree under out-tsc).
 * - If runTsc: false, returns the .ts path for ESBuild to compile directly.
 */
function copyAssetsStep(opts: ResolvedBundleOptions): void {
  const assets = opts.options.assets
  if (!assets?.length) {
    return
  }

  const { outputDirAbsolute, workspaceRoot } = opts
  console.log('🚀 Copying assets into output dir...')

  for (const entry of assets) {
    if (typeof entry === 'string') {
      const src = path.resolve(workspaceRoot, entry)
      if (!fs.existsSync(src)) {
        console.warn(`  ⚠️ Asset path missing (skip): ${entry}`)
        continue
      }
      const dest = path.join(outputDirAbsolute, path.basename(src))
      fs.cpSync(src, dest, { recursive: true })
      console.log(`  ✓ ${entry} -> ${path.relative(workspaceRoot, dest)}`)
    } else {
      const inputAbs = path.resolve(workspaceRoot, entry.input)
      if (!fs.existsSync(inputAbs)) {
        console.warn(`  ⚠️ Asset input dir missing (skip): ${entry.input}`)
        continue
      }
      const destBase = path.resolve(outputDirAbsolute, entry.output)
      assertResolvedPathUnderRoot(outputDirAbsolute, destBase, `assets[].output "${entry.output}"`)
      const relFiles = fg.sync(entry.glob, { cwd: inputAbs, onlyFiles: true, dot: true })
      if (relFiles.length === 0) {
        console.log(`  (no files matched: ${entry.input} / ${entry.glob})`)
        continue
      }
      for (const rel of relFiles) {
        const srcFile = path.join(inputAbs, rel)
        const destFile = path.resolve(destBase, rel)
        assertResolvedPathUnderRoot(
          outputDirAbsolute,
          destFile,
          `asset copy destination for output "${entry.output}" (matched "${rel}")`,
        )
        fs.mkdirSync(path.dirname(destFile), { recursive: true })
        fs.copyFileSync(srcFile, destFile)
      }
      console.log(`  ✓ ${relFiles.length} file(s) -> ${entry.output}/`)
    }
  }

  console.log('✓ Asset copy completed')
}

function resolveMainFileAbsolute({
  mainFile,
  projectRoot,
  projectRootAbsolute,
  runTsc,
  tscOutputDir,
}: {
  mainFile: string
  projectRoot: string
  projectRootAbsolute: string
  runTsc: boolean
  tscOutputDir: string
}): string {
  const resolved = path.resolve(projectRootAbsolute, mainFile)
  if (runTsc && /\.tsx?$/i.test(mainFile)) {
    const jsPath = mainFile.replace(/\.tsx?$/i, '.js')
    return path.resolve(projectRootAbsolute, tscOutputDir, projectRoot, jsPath)
  }
  return resolved
}

async function runEsbuildStep(opts: ResolvedBundleOptions) {
  console.log('🚀 [2/3] Running ESBuild...')

  const {
    mainFileAbsolute,
    outputDirAbsolute,
    outputFileAbsolute,
    metaFileAbsolute,
    tsconfigAbsolute,
    workspaceRoot,
    esbuildOpts,
  } = opts

  if (!fs.existsSync(mainFileAbsolute)) {
    throw new Error(`Main file not found: ${mainFileAbsolute}`)
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDirAbsolute)) {
    fs.mkdirSync(outputDirAbsolute, { recursive: true })
  }

  // Build esbuild command
  const esbuildArgs = [
    mainFileAbsolute,
    esbuildOpts.bundle ? '--bundle' : '',
    `--platform=${esbuildOpts.platform}`,
    `--packages=${esbuildOpts.packages}`,
    `--outfile=${outputFileAbsolute}`,
    `--format=${esbuildOpts.format}`,
    esbuildOpts.sourcemap ? '--sourcemap' : '',
    esbuildOpts.minify ? '--minify' : '',
    ...(opts.generateMinimalDeps ? [`--metafile=${metaFileAbsolute}`] : []),
    tsconfigAbsolute ? `--tsconfig=${tsconfigAbsolute}` : '',
  ].filter(Boolean)

  const esbuildCommand = `esbuild ${esbuildArgs.join(' ')}`

  console.log(`  Command: ${esbuildCommand}`)
  if (tsconfigAbsolute) {
    console.log(`  Tsconfig: ${tsconfigAbsolute}`)
  }
  if (opts.generateMinimalDeps) {
    console.log(`  Metafile: ${metaFileAbsolute}`)
  }

  try {
    execSync(esbuildCommand, {
      cwd: workspaceRoot,
      stdio: 'inherit',
    })
    console.log('✓ ESBuild bundling completed')
  } catch (error) {
    console.error('✗ ESBuild bundling failed')
    throw error
  }
}

async function runMinimizedDepsStep(opts: ResolvedBundleOptions, context: ExecutorContext) {
  if (!opts.generateMinimalDeps) {
    console.log('⏭️  [3/3 skipped] Minimal dependencies generation (generateMinimalDeps=false)')
    return
  }

  console.log('🚀 [3/3] Generating minimal dependencies...')
  const packageJsonPath = path.resolve(opts.outputDirAbsolute, 'package.json')

  console.log(`  Metafile: ${opts.metaFileAbsolute}`)
  console.log(`  Output package.json: ${packageJsonPath}`)

  if (opts.options.runtimeDeps && opts.options.runtimeDeps.length > 0) {
    console.warn(`  Runtime deps: ${opts.options.runtimeDeps.join(', ')}`)
  }

  await generateMinimalPackageJson({
    metaFilePath: opts.metaFileAbsolute,
    packageJsonPath,
    runtimeDeps: opts.options.runtimeDeps,
    workspaceRoot: context.root,
  })

  console.log('✓ Minimal dependencies generated')
}

async function runTscStep(opts: ResolvedBundleOptions) {
  if (!opts.runTsc) {
    console.log('⏭️  [1/3 skipped] TypeScript compilation (runTsc=false)')
    return
  }

  const effectiveTscCommand =
    opts.runTsc && opts.tsconfigAbsolute && opts.tscCommand === 'tsc --build'
      ? `tsc --build ${opts.tsconfigAbsolute}`
      : opts.tscCommand
  console.log('🚀 [1/3] Running TypeScript compiler...')
  console.log(`  Command: ${effectiveTscCommand}`)
  console.log(`  Working directory: ${opts.tscCwdAbsolute}`)
  if (opts.tsconfigAbsolute) {
    console.log(`  Tsconfig: ${opts.tsconfigAbsolute}`)
  }

  try {
    execSync(effectiveTscCommand, {
      cwd: opts.tscCwdAbsolute,
      stdio: 'inherit',
    })
    console.log('✓ TypeScript compilation completed')
  } catch (error) {
    console.error('✗ TypeScript compilation failed')
    throw error
  }
}
