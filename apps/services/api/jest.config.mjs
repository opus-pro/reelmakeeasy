// @ts-check
import { resolveJestConfig } from '../../../config/jest.base.mjs'

export default resolveJestConfig(
  {
    // Improve worker stability for large files
    // Reduce workers to prevent crashes when processing large files
    maxWorkers: process.env.CI ? 1 : 2,
    // Limit worker memory to prevent OOM crashes
    workerIdleMemoryLimit: '500MB',

    // Enforce high coverage for prompt composition files.
    coverageThreshold: {
      global: { statements: 18 },
      './src/**/*.prompt.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  import.meta.url,
)
