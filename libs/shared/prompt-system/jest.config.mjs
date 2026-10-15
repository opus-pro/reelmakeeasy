// @ts-check
import { resolveJestConfig } from '../../../config/jest.base.mjs'

export default resolveJestConfig(
  {
    // Enforce high coverage for prompt composition files.
    coverageThreshold: {
      global: { statements: 100 },
      './src/**/*.prompt.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  import.meta.url,
)
