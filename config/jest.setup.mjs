/**
 * Jest Setup for Unit Tests
 *
 * Unit tests should be fast and isolated from external dependencies.
 * This setup disables all network requests and mocks external APIs.
 */

// Detect test environment: jsdom has window object, node doesn't
const isJsdomEnvironment = typeof window !== 'undefined'

// Ensure React is in development mode for tests (required for act() support)
if (isJsdomEnvironment && process.env.NODE_ENV !== 'development') {
  process.env.NODE_ENV = 'development'
}

// Polyfill MessageChannel for jsdom (required by React 18+ server rendering)
if (isJsdomEnvironment && global.MessageChannel === undefined) {
  // eslint-disable-next-line no-restricted-syntax
  const { MessageChannel } = require('node:worker_threads')
  global.MessageChannel = MessageChannel
}

// Polyfill TextEncoder/TextDecoder for jsdom (required by React 18+ server rendering)
if (isJsdomEnvironment && global.TextEncoder === undefined) {
  // eslint-disable-next-line no-restricted-syntax
  const { TextEncoder, TextDecoder } = require('node:util')
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}

// Disable fetch in browser-like (jsdom) environment
global.fetch = jest.fn(() => {
  throw new Error('fetch is disabled in tests')
})

if (isJsdomEnvironment) {
  // Disable XHR (jsdom environment only)
  class DisabledXHR {
    constructor() {
      throw new Error('XHR is disabled in tests')
    }
  }
  global.XMLHttpRequest = DisabledXHR
} else {
  // Disable all network requests in unit tests
  // Block Node.js http/https requests
  // eslint-disable-next-line no-restricted-syntax
  const nock = require('nock')

  // Block all real network requests that are not mocked
  nock.disableNetConnect()

  // Clean up nock interceptors after each test
  afterEach(() => {
    nock.cleanAll()
  })

  // Restore patched http/https modules after all tests complete to
  // avoid memory leaks and keep Jest runs isolated.
  // All external HTTP(S) in tests must be mocked via nock; any
  // unmocked external call will fail due to disableNetConnect().
  afterAll(() => {
    nock.restore()
  })
}

// mute all console methods
const noop = () => void 0

if (process.env['DEBUG_MUTE_TEST_LOG'] === 'true') {
  const methods = ['log', 'info', 'debug', 'warn', 'error']
  methods.forEach((method) => {
    jest.spyOn(global.console, method).mockImplementation(noop)
  })
}

/**
 * Global Logger Mock
 *
 * Mocks @reelmakeeasy/common/logger for all tests by default to prevent verbose logging
 * and eliminate the need for per-test logger mocking.
 *
 * To enable the real logger in specific tests, set the environment variable:
 * ENABLE_TEST_LOGGER=true npm test
 *
 * @example
 * // In a specific test file, you can still access the mock:
 * const { createSubLogger } = jest.requireMock('@reelmakeeasy/common/logger')
 * expect(createSubLogger).toHaveBeenCalled()
 */
if (process.env['ENABLE_TEST_LOGGER'] !== 'true') {
  // Create a comprehensive logger mock that matches the actual logger interface
  class MockLogger {
    child = jest.fn(() => new MockLogger())
    debug = jest.fn()
    dist = jest.fn()
    error = jest.fn()
    getPinoLogger = jest.fn(() => ({ child: jest.fn() }))
    increment = jest.fn()
    info = jest.fn()
    log = jest.fn()
    trace = jest.fn()
    verbose = jest.fn()
    warn = jest.fn()
  }

  jest.mock('@reelmakeeasy/common/logger', () => ({
    Logger: MockLogger,
    logger: new MockLogger(),
    agentLogger: {
      child: jest.fn(() => ({ child: jest.fn() })),
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      trace: jest.fn(),
      warn: jest.fn(),
    },
    createSubLogger: jest.fn(() => new MockLogger()),
    getLogger: jest.fn(() => new MockLogger()),
    // Real pure export -- consumers call it directly, so the mock must actually work.
    objectToFlatString: (obj, joiner = '; ') =>
      Object.entries(obj)
        .map(([k, v]) => `${k}:${v}`)
        .join(joiner),
  }))
}
