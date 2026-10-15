import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

const RULE_NAME = 'logger-naming'

const messageId = 'default'
const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure getLogger uses a kebab-case string with no uppercase letters (":" OK)',
    },
    messages: {
      [messageId]:
        'The first parameter of getLogger must be a kebab-case literal string with no uppercase letters (variable not allowed).{{value}}',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression) {
        const { callee, arguments: args } = node

        if (callee.type === 'Identifier' && callee.name === 'getLogger' && args.length > 0) {
          const value = ''
          if (args[0].type === 'Literal' && typeof args[0].value === 'string') {
            const value = args[0].value
            const kebabCasePattern = /^[a-z]+(-[a-z0-9\\.]+)*$/
            if (kebabCasePattern.test(value)) return
          }
          context.report({
            node: args[0],
            messageId,
            data: {
              found: value ? ` Found: ${value}.` : '',
            },
          })
        }
      },
    }
  },
})

const loggerNamingRule: NxEslintRule = { RULE_NAME, rule }
export default loggerNamingRule
