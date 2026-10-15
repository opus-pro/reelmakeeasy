import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

const RULE_NAME = 'logger-no-dropped-args'

const messageId = 'droppedArgs'

// Browser loggers that forward every argument straight to console, so nothing is dropped.
const CONSOLE_BACKED_LOGGERS = new Set(['nsLogger', 'webLogger'])

const LOG_METHODS = new Set(['debug', 'error', 'info', 'log', 'trace', 'verbose', 'warn'])

function isLoggerCall(node: TSESTree.CallExpression): boolean {
  if (
    node.callee.type !== 'MemberExpression' ||
    node.callee.property.type !== 'Identifier' ||
    !LOG_METHODS.has(node.callee.property.name)
  ) {
    return false
  }

  const object = node.callee.object
  if (object.type === 'Identifier') {
    if (CONSOLE_BACKED_LOGGERS.has(object.name)) {
      return false
    }
    return object.name === 'logger' || object.name.endsWith('Logger')
  }

  return (
    object.type === 'MemberExpression' &&
    object.object.type === 'ThisExpression' &&
    object.property.type === 'Identifier' &&
    object.property.name === 'logger'
  )
}

// `%%` is an escaped percent, so it consumes no argument.
function countPlaceholders(text: string): number {
  return (text.match(/%[%sdifoOj]/g) ?? []).filter((token) => token !== '%%').length
}

function getStaticMessage(node: TSESTree.Node): string | undefined {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map((quasi) => quasi.value.raw).join('')
  }
  return undefined
}

const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow logger args that no printf placeholder consumes',
    },
    messages: {
      [messageId]:
        "pino drops logger args that no printf placeholder consumes. Pass them in the merging object instead, e.g. logger.error({ error }, 'msg').",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (!isLoggerCall(node)) {
          return
        }
        const args = node.arguments
        if (args.length < 2 || args.some((arg) => arg.type === 'SpreadElement')) {
          return
        }
        const message = getStaticMessage(args[0])
        if (message === undefined) {
          return
        }
        if (args.length - 1 > countPlaceholders(message)) {
          context.report({ node, messageId })
        }
      },
    }
  },
})

const loggerNoDroppedArgsRule: NxEslintRule = { RULE_NAME, rule }
export default loggerNoDroppedArgsRule
