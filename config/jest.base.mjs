// @ts-check

import { createRequire } from 'node:module'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
// resolve the absolute path of given module
const require = createRequire(join(import.meta.url))

const defaultTsJestOptions =
  /** @type {import('ts-jest').TsJestTransformerOptions & Record<string, unknown>} */ ({
    tsconfig: { isolatedModules: true, module: 'commonjs', types: ['jest', 'node', 'multer'] },
  })

/**
 * Create a ts-jest transform entry merged with the repo defaults.
 * @param {import('ts-jest').TsJestTransformerOptions & Record<string, unknown>} [overrides]
 * @returns {[string, import('ts-jest').TsJestTransformerOptions & Record<string, unknown>]}
 */
export function createTsJestTransform(overrides) {
  const overrideOptions = { ...overrides, diagnostics: false }

  const options =
    /** @type {import('ts-jest').TsJestTransformerOptions & Record<string, unknown>} */ ({
      ...defaultTsJestOptions,
      ...overrideOptions,
      tsconfig: overrideOptions.tsconfig ?? defaultTsJestOptions.tsconfig,
    })

  return ['ts-jest', options]
}

/***
 * Resolve the Jest config for a given project.
 * @param {import("jest").Config} config - The Jest config for the project.
 * @param {string} configFileUri - The URI of the config file. Use import.meta.url for the current file.
 * @returns {import("jest").Config} The resolved Jest config.
 */
export function resolveJestConfig(config = {}, configFileUri) {
  const projectDir = dirname(fileURLToPath(configFileUri))
  const workingDir = projectDir
  const toRoot = relative(workingDir, projectRootDir)
  const childDir = relative(projectRootDir, projectDir)

  /** @param {string} dir */
  const resolveToRootDir = (dir) => (toRoot ? `${toRoot}/${dir}` : dir)
  /** @param {string} dir */
  const rootDirTo = (dir) => `<rootDir>/${resolveToRootDir(dir)}`
  const displayName = config.displayName ?? basename(childDir)

  const { moduleNameMapper, transform, ...configExt } = config
  const coverageDirectory = configExt.coverageDirectory ?? resolveToRootDir(`coverage/${childDir}`)

  // fix lodash-es
  const lodashEs = 'lodash-es'
  const lodashCjs = 'lodash'

  /** @type {import("jest").Config} **/
  return {
    /*** Test environment & discovery ***/

    /**
     * What: Jest test environment (Node instead of the default jsdom).
     * Why: Our code primarily runs in a Node context (NestJS/CLI), so this matches runtime behavior and avoids jsdom quirks.
     */
    testEnvironment: 'node',

    /**
     * What: File extensions Jest will look for when resolving modules.
     * Why: We only support TypeScript and JavaScript in this repo, which keeps resolution predictable and fast.
     */
    moduleFileExtensions: ['ts', 'js'],

    /**
     * What: Explicitly disable any Jest preset.
     * Why: Nx and this shared base config control all Jest wiring; leaving this undefined avoids accidental preset coupling.
     */
    preset: undefined,

    /**
     * What: Glob patterns Jest uses to discover test files.
     * Why: Standardize on *.test.* under src to avoid picking up helpers and keep test locations consistent.
     */
    testMatch: ['<rootDir>/src/**/*.test.[jt]s?(x)'],

    /**
     * What: Succeed when a project has no test files.
     * Why: The suites were dropped for a rewrite; projects without tests yet should not fail `nx test`.
     */
    passWithNoTests: true,

    /*** Coverage configuration ***/

    /**
     * What: Include/exclude patterns for coverage collection.
     * Why: Measure coverage only on real source files while excluding type declarations, tests, and generated code.
     */
    collectCoverageFrom: [
      '<rootDir>/src/**/*.{ts,tsx}',
      '!<rootDir>/src/**/*.d.ts',
      '!<rootDir>/src/**/*.test.[tj]s?(x)',
      '!<rootDir>/src/**/__tests__/**',
      '!<rootDir>/src/**/*.mock.[tj]s?(x)',
      '!<rootDir>/src/generated/**',
      '!<rootDir>/src/**/scripts/**',
    ],

    /*** Jest runtime setup ***/

    /**
     * What: Files executed after the Jest environment is set up.
     * Why: Central place to register matchers, polyfills, and global test helpers shared across projects.
     */
    setupFilesAfterEnv: [rootDirTo('config/jest.setup.mjs')],

    /*** Transforms & module resolution ***/

    /**
     * What: Patterns in node_modules that Jest should skip transforming.
     * Why: Generally skip node_modules for performance, but ESM-only packages must be
     * transformed or Jest (CJS) fails on their `import` statements with "Cannot use import
     * statement outside a module". lodash-es is the only one left, and it is also redirected to
     * CJS via moduleNameMapper below.
     */
    transformIgnorePatterns: [`node_modules/(?!${lodashEs})`],

    /**
     * What: Custom module name mappings for Jest.
     * Why: Normalize ESM/CJS differences and support our TS path-style imports (e.g. @reelmakeeasy/common, @agent-lib) inside tests.
     */
    moduleNameMapper: {
      [`^${lodashEs}$`]: lodashCjs,
      '^axios$': require.resolve('axios'),
      '^@reelmakeeasy/common/(.*)$': `<rootDir>/${resolveToRootDir('libs/shared/common/src/$1')}`,
      '^@shared/prompt-system/(.*)$': `<rootDir>/${resolveToRootDir('libs/shared/prompt-system/src/$1')}`,
      '^@shared/db-access-layer$': `<rootDir>/${resolveToRootDir('libs/shared/db-access-layer/src/index.ts')}`,
      '^@reelmakeeasy/api-db$': `<rootDir>/${resolveToRootDir('libs/api/db/src/index.ts')}`,
      '^@shared/db-access-layer/(.*)$': `<rootDir>/${resolveToRootDir('libs/shared/db-access-layer/src/$1')}`,
      '^@shared/render-services/(.*)$': `<rootDir>/${resolveToRootDir('libs/shared/render-services/src/$1')}`,
      '^@shared/types/(.*)$': `<rootDir>/${resolveToRootDir('libs/shared/types/src/$1')}`,
      '^@agent-lib/(.*)$': `<rootDir>/${resolveToRootDir('libs/agent/src/$1')}`,
      '^@reelmakeeasy/llm$': `<rootDir>/${resolveToRootDir('libs/llm/src/index.ts')}`,
      '^@reelmakeeasy/llm/(.*)$': `<rootDir>/${resolveToRootDir('libs/llm/src/$1')}`,
      '^@reelmakeeasy/workflow-engine/(.*)$': `<rootDir>/${resolveToRootDir(
        'libs/workflow-engine/src/$1',
      )}`,
      '^@reelmakeeasy/story-mode-workers$': `<rootDir>/${resolveToRootDir(
        'apps/services/story-mode/src/register.ts',
      )}`,
      '^@reelmakeeasy/render-worker$': `<rootDir>/${resolveToRootDir(
        'apps/services/render/src/register.ts',
      )}`,
      '^@reelmakeeasy/story-mode-runtime$': `<rootDir>/${resolveToRootDir(
        'libs/story-mode-runtime/src/index.ts',
      )}`,
      '^@reelmakeeasy/story-mode-runtime/(.*)$': `<rootDir>/${resolveToRootDir(
        'libs/story-mode-runtime/src/$1',
      )}`,
      '^@reelmakeeasy/uip-planner-runtime$': `<rootDir>/${resolveToRootDir(
        'libs/uip-planner-runtime/src/index.ts',
      )}`,
      '^@reelmakeeasy/uip-planner-runtime/(.*)$': `<rootDir>/${resolveToRootDir(
        'libs/uip-planner-runtime/src/$1',
      )}`,
      '^@reelmakeeasy/story-mode-judges$': `<rootDir>/${resolveToRootDir(
        'libs/story-mode-judges/src/index.ts',
      )}`,
      '^@reelmakeeasy/story-mode-judges/(.*)$': `<rootDir>/${resolveToRootDir(
        'libs/story-mode-judges/src/$1',
      )}`,
      ...moduleNameMapper,
    },

    /**
     * What: Default transform for TS/JS files.
     * Why: Use ts-jest with a CommonJS tsconfig to align with Jest's Node runtime, while still allowing projects to override via config.
     */
    transform: transform ?? {
      '^.+\\.[tj]s$': createTsJestTransform(),
    },

    /*** Timeouts ***/

    /**
     * What: Per-test timeout in milliseconds.
     * Why: Catch hanging tests while still being generous enough for async/IO-heavy scenarios.
     */
    testTimeout: 30000,

    /*** Project-level extensions ***/

    /**
     * What: Allow per-project Jest config to extend this base config.
     * Why: Consumers can opt into extra configuration, but core defaults above remain shared and opinionated.
     */
    ...configExt,

    /**
     * What: Formats for coverage output.
     * Why: 'text-summary' gives a quick terminal overview; 'lcov' generates files needed for CI/CD tools.
     */
    coverageReporters: ['text-summary', 'lcov'],

    /**
     * What: Directory where Jest writes coverage reports for this project.
     * Why: Keep per-project coverage isolated under coverage/<childDir> so Nx and tooling can consume it easily.
     */
    coverageDirectory,

    /**
     * What: Human-friendly name shown in Jest output.
     * Why: Use the child directory name so multi-project Jest runs are easier to scan.
     */
    displayName,
  }
}
