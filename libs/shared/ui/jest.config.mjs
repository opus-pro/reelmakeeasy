// @ts-check
import { createTsJestTransform, resolveJestConfig } from '../../../config/jest.base.mjs'

export default resolveJestConfig(
  {
    // React 18's scheduler keeps a MessageChannel port open; forceExit prevents hanging
    forceExit: true,
    testEnvironment: 'jsdom',
    // The base config's moduleFileExtensions/transform only cover .ts/.js; extend both to
    // .tsx so Workbench.test.tsx (a React component test) is discovered and transformed.
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
    transform: {
      '^.+\\.[tj]sx?$': createTsJestTransform(),
    },
  },
  import.meta.url,
)
