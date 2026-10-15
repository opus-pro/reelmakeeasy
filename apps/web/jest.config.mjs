// @ts-check
import { resolveJestConfig } from '../../config/jest.base.mjs'

export default resolveJestConfig(
  {
    // React 18's scheduler keeps a MessageChannel port open; forceExit prevents hanging
    forceExit: true,
    testEnvironment: 'jsdom',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
    moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/src/$1',
      '^@shared/ui$': '<rootDir>/../../libs/shared/ui/src',
      '^@shared/ui/(.*)$': '<rootDir>/../../libs/shared/ui/src/$1',
    },
    transform: {
      '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
      '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/next/babel'] }],
    },
  },
  import.meta.url,
)
