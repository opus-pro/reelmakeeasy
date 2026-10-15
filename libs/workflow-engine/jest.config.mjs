// @ts-check
import { resolveJestConfig } from '../../config/jest.base.mjs'

export default resolveJestConfig(
  {
    displayName: 'workflow-engine',
    testMatch: ['<rootDir>/src/**/*.test.[jt]s?(x)'],
    testPathIgnorePatterns: ['/node_modules/'],
    collectCoverageFrom: [
      '<rootDir>/src/**/*.{ts,tsx}',
      '!<rootDir>/src/**/*.d.ts',
      '!<rootDir>/src/**/*.test.[tj]s?(x)',
      '!<rootDir>/src/**/__tests__/**',
    ],
  },
  import.meta.url,
)
