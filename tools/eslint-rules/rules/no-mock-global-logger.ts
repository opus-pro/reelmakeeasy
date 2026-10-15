import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

const RULE_NAME = 'no-mock-global-logger'

const messageId = 'noMockLogger'
const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prevent mocking @reelmakeeasy/common/logger in test files. Logger is globally mocked in jest.setup.mjs. Use ENABLE_TEST_LOGGER=true to enable real logger if needed.',
    },
    messages: {
      [messageId]:
        'Do not mock @reelmakeeasy/common/logger locally. The logger is globally mocked in jest.setup.mjs. To enable the real logger in tests, set ENABLE_TEST_LOGGER=true environment variable.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression) {
        const { callee, arguments: args } = node

        // Check if this is a jest.mock() call
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'jest' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'mock' &&
          args.length > 0
        ) {
          // Check if the first argument is '@reelmakeeasy/common/logger'
          const firstArg = args[0]
          if (firstArg.type === 'Literal' && firstArg.value === '@reelmakeeasy/common/logger') {
            context.report({
              node,
              messageId,
            })
          }
        }
      },
    }
  },
})

const noMockGlobalLoggerRule: NxEslintRule = { RULE_NAME, rule }
export default noMockGlobalLoggerRule
