import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

const RULE_NAME = 'prefer-structured-logger-error'

const messageIds = {
  preferStructuredError: 'preferStructuredError',
} as const

function isEnsureErrorCall(node: TSESTree.Node): boolean {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'ensureError'
  )
}

function isErrorIdentifier(node: TSESTree.Node): boolean {
  return node.type === 'Identifier' && ['e', 'err', 'error'].includes(node.name)
}

function isLoggerError(node: TSESTree.CallExpression): boolean {
  if (
    node.callee.type !== 'MemberExpression' ||
    node.callee.property.type !== 'Identifier' ||
    node.callee.property.name !== 'error'
  ) {
    return false
  }

  const object = node.callee.object
  if (object.type === 'Identifier') {
    return object.name === 'logger' || object.name === 'Logger'
  }

  if (
    object.type === 'MemberExpression' &&
    object.object.type === 'ThisExpression' &&
    object.property.type === 'Identifier' &&
    object.property.name === 'logger'
  ) {
    return true
  }

  return false
}

const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce structured error logging with { error } object',
    },
    messages: {
      [messageIds.preferStructuredError]:
        'Use structured logging for errors: logger.error({ error: ... }, ...)',
    },
    schema: [],
    fixable: 'code',
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (!isLoggerError(node)) return

        const args = node.arguments
        if (args.length === 0) return

        const firstArg = args[0]

        // Case 1: logger.error(ensureError(err), ...)
        if (isEnsureErrorCall(firstArg)) {
          context.report({
            node: firstArg,
            messageId: messageIds.preferStructuredError,
            fix(fixer) {
              const argText = context.sourceCode.getText(firstArg)
              return fixer.replaceText(firstArg, `{ error: ${argText} }`)
            },
          })
          return
        }

        // Case 2: logger.error(err, ...) or logger.error(error, ...) or logger.error(e, ...)
        if (isErrorIdentifier(firstArg)) {
          context.report({
            node: firstArg,
            messageId: messageIds.preferStructuredError,
            fix(fixer) {
              const argText = context.sourceCode.getText(firstArg)
              // { error: err } or { error } if name is 'error'
              if ('name' in firstArg && firstArg.name === 'error') {
                return fixer.replaceText(firstArg, '{ error }')
              }
              return fixer.replaceText(firstArg, `{ error: ${argText} }`)
            },
          })
          return
        }

        // Case 3: logger.error('message', err) -> logger.error({ error: err }, 'message')
        if (args.length >= 2) {
          const secondArg = args[1]
          if (
            firstArg.type === 'Literal' &&
            typeof firstArg.value === 'string' &&
            (isErrorIdentifier(secondArg) || isEnsureErrorCall(secondArg))
          ) {
            context.report({
              node,
              messageId: messageIds.preferStructuredError,
              fix(fixer) {
                const msgText = context.sourceCode.getText(firstArg)
                const errText = context.sourceCode.getText(secondArg)

                let errorObj = `{ error: ${errText} }`
                if ('name' in secondArg && secondArg.name === 'error') {
                  errorObj = '{ error }'
                }

                const rangeStart = firstArg.range[0]
                const rangeEnd = secondArg.range[1]

                return fixer.replaceTextRange([rangeStart, rangeEnd], `${errorObj}, ${msgText}`)
              },
            })
          }
        }
      },
    }
  },
})

const preferStructuredLoggerErrorRule: NxEslintRule = { RULE_NAME, rule }
export default preferStructuredLoggerErrorRule
