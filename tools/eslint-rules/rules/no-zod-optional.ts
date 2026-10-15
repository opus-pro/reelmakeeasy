import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

import { containsZodOptional, isLikelyZodSchema } from './zod-helpers'

const RULE_NAME = 'no-zod-optional'

const messageIds = {
  noZodOptional: 'noZodOptional',
  noZodOptionalInCompletion: 'noZodOptionalInCompletion',
} as const

/**
 * ESLint rule to prevent using .optional() with Zod schemas in OpenAI completion() calls
 *
 * Strategy:
 * Only flag schemas used as responseFormat in completion() calls
 * - Tracks variable definitions that contain .optional()
 * - Reports error at the responseFormat usage site in completion()
 * - No false positives for client-side validation schemas
 */
const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'Prohibit usage of Zod .optional() in responseFormat for completion() calls',
    },
    messages: {
      [messageIds.noZodOptional]:
        'This schema contains .optional() which is not supported by OpenAI Structured Outputs API. Use .nullable() or .nullable().default(null) instead. See: https://platform.openai.com/docs/guides/structured-outputs',
      [messageIds.noZodOptionalInCompletion]:
        'The responseFormat schema contains .optional() which causes errors with OpenAI Structured Outputs API. Use .nullable() or .nullable().default(null) instead. See: https://platform.openai.com/docs/guides/structured-outputs',
    },
    schema: [],
    fixable: undefined,
  },
  defaultOptions: [],
  create(context) {
    // Track which variables contain schemas with .optional()
    const schemasWithOptional = new Set<string>()

    return {
      // First pass: Track all variable declarations that contain .optional()
      VariableDeclarator(node: TSESTree.VariableDeclarator) {
        if (
          node.id.type === 'Identifier' &&
          node.init &&
          isLikelyZodSchema(node.init) &&
          containsZodOptional(node.init)
        ) {
          schemasWithOptional.add(node.id.name)
        }
      },

      // Second pass: Check completion() calls for responseFormat
      CallExpression(node: TSESTree.CallExpression) {
        if (!isCompletionCall(node)) {
          return
        }

        const optionsArg = node.arguments[0]
        if (optionsArg.type !== 'ObjectExpression') {
          return
        }

        checkResponseFormatInOptions(optionsArg, schemasWithOptional, context)
      },
    }
  },
})

/**
 * Check if a CallExpression is a completion() call
 */
function isCompletionCall(node: TSESTree.CallExpression): boolean {
  return (
    node.callee.type === 'Identifier' &&
    node.callee.name === 'completion' &&
    node.arguments.length > 0
  )
}

/**
 * Check responseFormat property in completion options
 */
function checkResponseFormatInOptions(
  optionsArg: TSESTree.ObjectExpression,
  schemasWithOptional: Set<string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any,
): void {
  for (const prop of optionsArg.properties) {
    if (prop.type !== 'Property' || prop.key.type !== 'Identifier') {
      continue
    }

    if (prop.key.name !== 'responseFormat') {
      continue
    }

    // Case 1: Inline schema with .optional()
    if (containsZodOptional(prop.value)) {
      context.report({
        node: prop.value,
        messageId: messageIds.noZodOptionalInCompletion,
      })
      continue
    }

    // Case 2: Variable reference that contains .optional()
    if (prop.value.type === 'Identifier' && schemasWithOptional.has(prop.value.name)) {
      context.report({
        node: prop.value,
        messageId: messageIds.noZodOptionalInCompletion,
      })
    }
  }
}

const noZodOptionalRule: NxEslintRule = { RULE_NAME, rule }
export default noZodOptionalRule
