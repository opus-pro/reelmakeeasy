import { ESLintUtils, TSESLint, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

import { containsZodUnknown, isLikelyZodSchema } from './zod-helpers'

const RULE_NAME = 'no-zod-unknown'

const messageIds = {
  noZodUnknown: 'noZodUnknown',
  noZodUnknownInCompletion: 'noZodUnknownInCompletion',
} as const
type MessageId = (typeof messageIds)[keyof typeof messageIds]

/**
 * ESLint rule to prevent using z.unknown() with Zod schemas in OpenAI completion() calls
 */
const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prohibit usage of Zod z.unknown() in responseFormat for completion() calls because OpenAI requires explicit types',
    },
    messages: {
      [messageIds.noZodUnknown]:
        'This schema contains z.unknown() which is not supported by OpenAI Structured Outputs API. Use explicit types instead.',
      [messageIds.noZodUnknownInCompletion]:
        'The responseFormat schema contains z.unknown() which causes errors with OpenAI Structured Outputs API. Use explicit types instead.',
    },
    schema: [],
    fixable: undefined,
  },
  defaultOptions: [],
  create(context) {
    const schemasWithUnknown = new Set<string>()

    return {
      VariableDeclarator(node: TSESTree.VariableDeclarator) {
        if (
          node.id.type === 'Identifier' &&
          node.init &&
          isLikelyZodSchema(node.init) &&
          containsZodUnknown(node.init)
        ) {
          schemasWithUnknown.add(node.id.name)
        }
      },

      CallExpression(node: TSESTree.CallExpression) {
        if (!isCompletionCall(node)) {
          return
        }

        const optionsArg = node.arguments[0]
        if (optionsArg.type !== 'ObjectExpression') {
          return
        }

        checkResponseFormatInOptions(optionsArg, schemasWithUnknown, context)
      },
    }
  },
})

function checkResponseFormatInOptions(
  optionsArg: TSESTree.ObjectExpression,
  schemasWithUnknown: Set<string>,
  context: TSESLint.RuleContext<MessageId, readonly unknown[]>,
): void {
  for (const prop of optionsArg.properties) {
    if (prop.type !== 'Property' || prop.key.type !== 'Identifier') {
      continue
    }

    if (prop.key.name !== 'responseFormat') {
      continue
    }

    if (containsZodUnknown(prop.value)) {
      context.report({
        node: prop.value,
        messageId: messageIds.noZodUnknownInCompletion,
      })
      continue
    }

    if (prop.value.type === 'Identifier' && schemasWithUnknown.has(prop.value.name)) {
      context.report({
        node: prop.value,
        messageId: messageIds.noZodUnknownInCompletion,
      })
    }
  }
}

function isCompletionCall(node: TSESTree.CallExpression): boolean {
  return (
    node.callee.type === 'Identifier' &&
    node.callee.name === 'completion' &&
    node.arguments.length > 0
  )
}

const noZodUnknownRule: NxEslintRule = { RULE_NAME, rule }
export default noZodUnknownRule
