// @ts-check
import { resolveJestConfig } from '../../config/jest.base.mjs'

export default resolveJestConfig(
  {
    displayName: 'story-mode-runtime',
    testMatch: ['<rootDir>/src/**/*.test.[jt]s?(x)'],
    collectCoverageFrom: [
      '<rootDir>/src/**/*.{ts,tsx}',
      '!<rootDir>/src/**/*.d.ts',
      '!<rootDir>/src/**/*.test.[tj]s?(x)',
      '!<rootDir>/src/**/__tests__/**',
    ],
  },
  import.meta.url,
)
